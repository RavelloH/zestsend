import { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUpload, FiFile, FiDownload, FiCheck, FiX } from 'react-icons/fi';

export default function FileTransfer({ onSendFile, receivedFiles = [] }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState({});
  const fileInputRef = useRef(null);

  const onDrop = useCallback(acceptedFiles => {
    const newFiles = acceptedFiles.map(file => ({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: 'ready'
    }));
    setSelectedFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleSendFile = async (fileObj) => {
    try {
      setSending(prev => ({ ...prev, [fileObj.id]: true }));
      
      await onSendFile(fileObj.file);
      
      // 更新状态为已发送
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'sent', progress: 100 } : f
        )
      );
    } catch (error) {
      console.error('File sending error:', error);
      // 更新状态为发送失败
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'failed' } : f
        )
      );
    } finally {
      setSending(prev => {
        const newState = { ...prev };
        delete newState[fileObj.id];
        return newState;
      });
    }
  };

  const removeFile = (id) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
  };

  const downloadFile = (file) => {
    const url = URL.createObjectURL(file.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`drag-area border-dashed border-2 rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-700'}`}
      >
        <input {...getInputProps()} ref={fileInputRef} />
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="flex flex-col items-center justify-center py-4"
        >
          <FiUpload className="text-4xl mb-3 text-indigo-500" />
          <p className="mb-2 text-gray-700 dark:text-gray-300">
            {isDragActive ? '拖放文件至此处' : '点击或拖放文件至此处'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            支持任何类型的文件
          </p>
        </motion.div>
      </div>

      {/* 选择的文件列表 */}
      {selectedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2">待发送文件</h3>
          <div className="space-y-2">
            <AnimatePresence>
              {selectedFiles.map(fileObj => (
                <motion.div
                  key={fileObj.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex items-center"
                >
                  <div className="text-2xl mr-3">
                    <FiFile className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{fileObj.file.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(fileObj.file.size)}
                    </p>
                    {fileObj.status === 'sent' && (
                      <p className="text-xs text-green-500 flex items-center mt-1">
                        <FiCheck className="mr-1" /> 已发送
                      </p>
                    )}
                    {fileObj.status === 'failed' && (
                      <p className="text-xs text-red-500 flex items-center mt-1">
                        <FiX className="mr-1" /> 发送失败
                      </p>
                    )}
                  </div>
                  {fileObj.status === 'ready' && (
                    <button
                      onClick={() => handleSendFile(fileObj)}
                      disabled={sending[fileObj.id]}
                      className="btn btn-sm btn-primary ml-2 flex-shrink-0"
                    >
                      {sending[fileObj.id] ? '发送中...' : '发送'}
                    </button>
                  )}
                  <button
                    onClick={() => removeFile(fileObj.id)}
                    className="ml-2 text-gray-500 hover:text-red-500 flex-shrink-0"
                  >
                    <FiX />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 接收的文件列表 */}
      {receivedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2">已接收文件</h3>
          <div className="space-y-2">
            <AnimatePresence>
              {receivedFiles.map(file => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex items-center"
                >
                  <div className="text-2xl mr-3">
                    <FiFile className="text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <button
                    onClick={() => downloadFile(file)}
                    className="btn btn-sm btn-primary ml-2 flex-shrink-0"
                  >
                    <FiDownload className="mr-1" /> 下载
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
