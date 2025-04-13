import { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';

export default function FileTransfer({ peer, fileChannel }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState(''); // 'sending', 'receiving', 'completed', 'error'
  const [error, setError] = useState('');
  
  const chunkSize = 16 * 1024; // 16KB 块大小
  const currentFile = useRef(null);
  
  // 处理接收的文件数据
  useEffect(() => {
    if (!fileChannel) return;

    let incomingFileInfo = null;
    let incomingFileData = [];
    let receivedSize = 0;
    
    fileChannel.onmessage = (event) => {
      const data = event.data;
      
      // 如果是文件信息
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);
          
          if (message.type === 'file-info') {
            incomingFileInfo = message.file;
            incomingFileData = [];
            receivedSize = 0;
            setTransferStatus('receiving');
            setTransferProgress(0);
          } else if (message.type === 'file-complete') {
            const fileBlob = new Blob(incomingFileData);
            const fileURL = URL.createObjectURL(fileBlob);
            
            setReceivedFiles(prev => [
              ...prev,
              {
                id: Date.now(),
                name: incomingFileInfo.name,
                size: incomingFileInfo.size,
                type: incomingFileInfo.type,
                url: fileURL
              }
            ]);
            
            setTransferStatus('completed');
            setTransferProgress(100);
            
            // 清理
            incomingFileInfo = null;
            incomingFileData = [];
            receivedSize = 0;
          }
        } catch (err) {
          console.error('解析文件消息失败:', err);
          setError('接收文件失败：消息格式错误');
          setTransferStatus('error');
        }
      } else if (incomingFileInfo) {
        // 接收文件块
        incomingFileData.push(data);
        receivedSize += data.size;
        const progress = Math.min((receivedSize / incomingFileInfo.size) * 100, 100);
        setTransferProgress(progress);
      }
    };
    
    fileChannel.onerror = (error) => {
      console.error('文件传输通道错误:', error);
      setError(`文件传输错误: ${error.message}`);
      setTransferStatus('error');
    };
    
    return () => {
      if (fileChannel) {
        fileChannel.onmessage = null;
        fileChannel.onerror = null;
      }
    };
  }, [fileChannel]);
  
  // 文件拖放处理
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        // 只处理第一个文件
        setSelectedFile(acceptedFiles[0]);
      }
    },
    multiple: false,
  });

  // 检查连接状态
  const isChannelReady = () => {
    if (!fileChannel) {
      console.log('文件通道不可用');
      return false;
    }
    
    const readyState = fileChannel.readyState;
    console.log('文件通道状态:', readyState);
    return readyState === 'open';
  };
  
  // 发送文件 - 优化分块传输逻辑
  const sendFile = async () => {
    if (!selectedFile || !isChannelReady() || transferStatus === 'sending') {
      console.log('无法发送文件:', !selectedFile ? '没有选择文件' : !isChannelReady() ? '通道未就绪' : '正在传输中');
      return;
    }
    
    try {
      setTransferStatus('sending');
      setTransferProgress(0);
      
      const file = selectedFile;
      currentFile.current = file;
      
      // 发送文件信息
      fileChannel.send(JSON.stringify({
        type: 'file-info',
        file: {
          name: file.name,
          size: file.size,
          type: file.type
        }
      }));
      
      // 等待缓冲区清空的函数
      const waitForBufferToEmpty = () => {
        return new Promise(resolve => {
          if (fileChannel.bufferedAmount === 0) {
            resolve();
          } else {
            const checkBuffer = () => {
              if (fileChannel.bufferedAmount === 0) {
                resolve();
              } else {
                setTimeout(checkBuffer, 100);
              }
            };
            setTimeout(checkBuffer, 100);
          }
        });
      };
      
      let offset = 0;
      let sentSize = 0;
      
      while (offset < file.size) {
        // 如果缓冲区过大，等待减少
        if (fileChannel.bufferedAmount > 16 * 1024 * 1024) { // 16MB缓冲区上限
          await waitForBufferToEmpty();
        }
        
        const slice = file.slice(offset, offset + chunkSize);
        fileChannel.send(slice);
        
        offset += chunkSize;
        sentSize += slice.size;
        
        const progress = Math.min((sentSize / file.size) * 100, 100);
        setTransferProgress(progress);
        
        // 添加小延迟，给UI时间更新
        if (offset % (chunkSize * 10) === 0) { // 每10个块更新一次UI
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // 发送完成消息
      await waitForBufferToEmpty(); // 确保所有数据已发送
      fileChannel.send(JSON.stringify({
        type: 'file-complete'
      }));
      
      setTransferStatus('completed');
      
    } catch (err) {
      console.error('发送文件失败:', err);
      setError(`发送文件失败: ${err.message}`);
      setTransferStatus('error');
    }
  };
  
  // 取消文件发送
  const cancelTransfer = () => {
    setSelectedFile(null);
    setTransferStatus('');
    setTransferProgress(0);
    setError('');
    currentFile.current = null;
  };
  
  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold mb-4">文件传输</h2>
      
      {!isChannelReady() && (
        <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-lg text-sm">
          正在等待连接建立，文件传输通道尚未准备好...
        </div>
      )}
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}
      
      {/* 文件选择区域 */}
      {!selectedFile && transferStatus !== 'receiving' && (
        <div {...getRootProps()} className={`drop-zone ${isDragActive ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : ''}`}>
          <input {...getInputProps()} />
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-lg mb-1">{isDragActive ? '放开以添加文件' : '拖放文件到此处'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">或点击选择文件</p>
        </div>
      )}
      
      {/* 选中的文件 */}
      {selectedFile && (
        <div className="mb-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border">
            <div className="flex items-center">
              <div className="w-10 h-10 flex-shrink-0 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="font-medium truncate max-w-[200px]">{selectedFile.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{formatFileSize(selectedFile.size)}</p>
              </div>
            </div>
            <button 
              onClick={cancelTransfer}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {transferStatus === 'sending' || transferStatus === 'completed' ? (
            <div className="mt-4">
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">传输进度</span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{Math.round(transferProgress)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-dark-border rounded-full h-2.5">
                <motion.div 
                  className="bg-primary-600 h-2.5 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${transferProgress}%` }}
                  transition={{ duration: 0.3 }}
                ></motion.div>
              </div>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={sendFile}
              disabled={!fileChannel}
              className="w-full btn-primary mt-4"
            >
              发送文件
            </motion.button>
          )}
        </div>
      )}
      
      {/* 接收文件进度 */}
      {transferStatus === 'receiving' && (
        <div className="mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-blue-800 dark:text-blue-300 font-medium">正在接收文件...</h3>
              <span className="text-sm text-blue-800 dark:text-blue-300">{Math.round(transferProgress)}%</span>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-800/30 rounded-full h-2.5">
              <motion.div 
                className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${transferProgress}%` }}
                transition={{ duration: 0.3 }}
              ></motion.div>
            </div>
          </div>
        </div>
      )}
      
      {/* 接收到的文件列表 */}
      {receivedFiles.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-2">接收的文件</h3>
          <div className="space-y-3">
            <AnimatePresence>
              {receivedFiles.map((file) => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="font-medium truncate max-w-[200px]">{file.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="btn-secondary text-sm"
                  >
                    下载
                  </a>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
