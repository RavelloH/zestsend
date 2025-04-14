import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUpload, FiFile, FiDownload, FiCheck, FiX, FiLoader } from 'react-icons/fi';

export default function FileTransfer({ onSendFile, receivedFiles = [] }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState({});
  const [fileProgress, setFileProgress] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [inProgress, setInProgress] = useState(false);
  const fileInputRef = useRef(null);
  const sendQueueRef = useRef([]);
  const currentlySendingRef = useRef(false);

  // 监听发送文件进度更新 - 增强版
  useEffect(() => {
    // 添加全局事件监听器接收进度更新
    const handleFileProgress = (event) => {
      if (event.detail && event.detail.fileId) {
        console.log('接收到文件进度更新:', event.detail);
        setFileProgress(prev => ({
          ...prev,
          [event.detail.fileId]: event.detail.progress || 0
        }));
      }
    };

    window.addEventListener('file-progress', handleFileProgress);
    
    // 清理函数
    return () => {
      window.removeEventListener('file-progress', handleFileProgress);
    };
  }, []);

  // 显示收到的文件状态更多信息
  useEffect(() => {
    if (receivedFiles.length > 0) {
      console.log('接收的文件更新:', receivedFiles);
    }
  }, [receivedFiles]);

  const onDrop = useCallback(acceptedFiles => {
    // 过滤掉空文件或零字节文件
    const validFiles = acceptedFiles.filter(file => file && file.size > 0);
    
    if (validFiles.length === 0) {
      console.warn('All dropped files are empty or invalid');
      return;
    }
    
    const newFiles = validFiles.map(file => ({
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      file,
      progress: 0,
      status: 'ready',
      addedAt: Date.now()
    }));
    
    setSelectedFiles(prev => [...prev, ...newFiles]);
  }, []);

  // 配置dropzone，禁用点击行为，我们将使用自己的点击处理器
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ 
    onDrop,
    noClick: true, // 禁用点击事件，我们将使用自定义处理
  });

  // 主动触发文件选择器
  const handleClickUpload = () => {
    open(); // 打开文件选择器对话框
  };

  // 处理发送队列
  const processQueue = useCallback(async () => {
    if (currentlySendingRef.current || sendQueueRef.current.length === 0) {
      return;
    }
    
    currentlySendingRef.current = true;
    setInProgress(true);
    
    try {
      const fileObj = sendQueueRef.current.shift();
      if (!fileObj) {
        currentlySendingRef.current = false;
        setInProgress(false);
        return;
      }
      
      setSending(prev => ({ ...prev, [fileObj.id]: true }));
      
      // 初始化进度
      setFileProgress(prev => ({
        ...prev,
        [fileObj.id]: 0
      }));
      
      // 更新状态为发送中
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'sending' } : f
        )
      );
      
      await onSendFile(fileObj.file);
      
      // 更新状态为已发送
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'sent', progress: 100 } : f
        )
      );
    } catch (error) {
      console.error('File sending error:', error);
      // 如果有文件正在发送，更新其状态为失败
      if (sendQueueRef.current.length > 0) {
        const failedFile = sendQueueRef.current[0];
        setSelectedFiles(prev => 
          prev.map(f => 
            f.id === failedFile.id ? { ...f, status: 'failed' } : f
          )
        );
      }
    } finally {
      setTimeout(() => {
        setSending({});
        currentlySendingRef.current = false;
        
        // 处理队列中的下一个文件
        if (sendQueueRef.current.length > 0) {
          processQueue();
        } else {
          setInProgress(false);
        }
      }, 1000);
    }
  }, [onSendFile]);

  const handleSendFile = useCallback((fileObj) => {
    // 将文件加入发送队列
    sendQueueRef.current.push(fileObj);
    
    // 如果当前没有正在发送的文件，开始处理队列
    if (!currentlySendingRef.current) {
      processQueue();
    }
  }, [processQueue]);

  const removeFile = (id) => {
    // 如果文件在队列中，从队列中移除
    sendQueueRef.current = sendQueueRef.current.filter(f => f.id !== id);
    
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
    setFileProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[id];
      return newProgress;
    });
  };

  // 处理下载逻辑增强
  const downloadFile = (file) => {
    console.log('准备下载文件:', file);
    
    if (!file.data) {
      console.error('无法下载：文件数据为空');
      alert('文件下载失败：文件数据为空或已损坏');
      return;
    }

    if (file.size === 0) {
      console.error('无法下载：文件大小为零');
      alert('文件下载失败：文件大小为零');
      return;
    }
    
    try {
      // 设置下载进度为0，开始下载
      setDownloadProgress(prev => ({
        ...prev,
        [file.id]: 0
      }));
      
      // 添加数据有效性检查
      if (!(file.data instanceof Blob)) {
        console.error('文件数据不是Blob类型:', typeof file.data);
        
        // 尝试创建Blob
        try {
          const blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
          if (blob.size === 0) {
            throw new Error('创建的Blob为空');
          }
          file.data = blob;
        } catch (blobError) {
          console.error('转换为Blob失败:', blobError);
          alert('文件数据格式错误，无法下载');
          
          setDownloadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[file.id];
            return newProgress;
          });
          return;
        }
      }
      
      // 检查Blob是否为空
      if (file.data.size === 0) {
        console.error('文件Blob大小为0');
        alert('文件为空（0字节），无法下载');
        
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[file.id];
          return newProgress;
        });
        return;
      }
      
      // 创建blob URL
      const url = URL.createObjectURL(file.data);
      console.log('文件Blob URL创建成功，大小:', file.data.size, '字节');
      
      // 模拟下载进度更快速一些
      let progress = 0;
      const interval = setInterval(() => {
        progress += 20;
        setDownloadProgress(prev => ({
          ...prev,
          [file.id]: progress > 100 ? 100 : progress
        }));
        
        if (progress >= 100) {
          clearInterval(interval);
          
          // 执行实际下载
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log('文件下载已触发:', file.name);
          
          // 下载完成后延迟清除进度
          setTimeout(() => {
            setDownloadProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[file.id];
              return newProgress;
            });
          }, 2000);
        }
      }, 50); // 更快的进度更新，让体验更流畅
    } catch (error) {
      console.error('File download error:', error);
      alert(`文件下载失败: ${error.message}`);
      
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[file.id];
        return newProgress;
      });
    }
  };

  // 进度条组件
  const ProgressBar = ({ progress, className = "", status = "normal" }) => {
    // 根据状态选择颜色
    const getColorClass = () => {
      switch (status) {
        case 'error': return 'bg-red-500';
        case 'success': return 'bg-green-500'; 
        default: return 'bg-indigo-500';
      }
    };
    
    return (
      <div className={`h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ${className}`}>
        <div 
          className={`h-full ${getColorClass()} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
    );
  };

  // 获取文件状态的显示类
  const getStatusClass = (status) => {
    switch (status) {
      case 'sent': return 'text-green-500';
      case 'failed': return 'text-red-500';
      case 'sending': return 'text-indigo-500';
      default: return 'text-gray-500';
    }
  };

  // 获取文件状态的显示文本
  const getStatusText = (status) => {
    switch (status) {
      case 'sent': return '已发送';
      case 'failed': return '发送失败';
      case 'sending': return '发送中...';
      case 'ready': return '待发送';
      default: return '';
    }
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`drag-area border-dashed border-2 rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-700'}`}
      >
        <input {...getInputProps()} />
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="flex flex-col items-center justify-center py-4"
          onClick={handleClickUpload} // 直接触发open()方法
        >
          <FiUpload className="text-4xl mb-3 text-indigo-500" />
          <p className="mb-2 text-gray-700 dark:text-gray-300">
            {isDragActive ? '拖放文件至此处' : '点击或拖放文件至此处'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            支持任何类型的文件
          </p>
          
          {/* 添加明确的上传按钮，确保可以触发文件选择 */}
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // 阻止事件冒泡
              open();
            }}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
            data-umami-event="选择文件"
          >
            选择文件
          </button>
        </motion.div>
      </div>

      {/* 选择的文件列表 */}
      {selectedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2 flex items-center justify-between">
            <span>待发送文件</span>
            {inProgress && (
              <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-1 rounded-full flex items-center">
                <FiLoader className="animate-spin mr-1" />
                发送中...
              </span>
            )}
          </h3>
          <div className="space-y-3">
            <AnimatePresence>
              {selectedFiles.map(fileObj => (
                <motion.div
                  key={fileObj.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex flex-col"
                >
                  <div className="flex items-center mb-2">
                    <div className="text-2xl mr-3">
                      <FiFile className="text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileObj.file.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(fileObj.file.size)}
                      </p>
                      {fileObj.status !== 'ready' && (
                        <p className={`text-xs flex items-center mt-1 ${getStatusClass(fileObj.status)}`}>
                          {fileObj.status === 'sent' && <FiCheck className="mr-1" />}
                          {fileObj.status === 'failed' && <FiX className="mr-1" />}
                          {fileObj.status === 'sending' && <FiLoader className="mr-1 animate-spin" />}
                          {getStatusText(fileObj.status)}
                        </p>
                      )}
                    </div>
                    {fileObj.status === 'ready' && (
                      <button
                        onClick={() => handleSendFile(fileObj)}
                        disabled={sending[fileObj.id] || inProgress}
                        className="ml-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                        data-umami-event="发送文件"
                      >
                        {sending[fileObj.id] ? '发送中...' : '发送'}
                      </button>
                    )}
                    {fileObj.status !== 'sending' && (
                      <button
                        onClick={() => removeFile(fileObj.id)}
                        className="ml-2 text-gray-500 hover:text-red-500 flex-shrink-0 p-1"
                        data-umami-event="移除文件"
                      >
                        <FiX />
                      </button>
                    )}
                  </div>
                  
                  {/* 显示进度条 */}
                  {(fileObj.status === 'sending' || fileProgress[fileObj.id] > 0) && (
                    <div className="mt-1">
                      <ProgressBar 
                        progress={fileProgress[fileObj.id] || 0} 
                        status={fileObj.status === 'failed' ? 'error' : (fileObj.status === 'sent' ? 'success' : 'normal')}
                      />
                      <p className="text-xs text-gray-500 mt-1 text-right">
                        {Math.round(fileProgress[fileObj.id] || 0)}%
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 接收的文件列表 - 增强版 */}
      {receivedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2 flex items-center justify-between">
            <span>已接收文件</span>
            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300 px-2 py-1 rounded-full">
              {receivedFiles.length} 个文件
            </span>
          </h3>
          <div className="space-y-3">
            <AnimatePresence>
              {receivedFiles.map(file => (
                <motion.div
                  key={file.id || `file-${file.name}-${Date.now()}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex flex-col"
                >
                  <div className="flex items-center mb-2">
                    <div className="text-2xl mr-3">
                      <FiFile className="text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(file.size || 0)}
                        {file.data && 
                         <span className="ml-2 text-green-500">
                           (数据已就绪: {formatBytes(file.data.size || 0)})
                         </span>
                        }
                      </p>
                    </div>
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={!file.data || (downloadProgress[file.id] > 0 && downloadProgress[file.id] < 100)}
                      className="ml-2 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                      data-umami-event="下载文件"
                    >
                      <FiDownload size={16} className="mr-1" />
                      <span>下载</span>
                    </button>
                  </div>
                  
                  {/* 下载进度条 */}
                  {downloadProgress[file.id] > 0 && (
                    <div className="mt-1">
                      <ProgressBar progress={downloadProgress[file.id]} status="success" />
                      <p className="text-xs text-gray-500 mt-1 text-right">
                        {Math.round(downloadProgress[file.id])}%
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
