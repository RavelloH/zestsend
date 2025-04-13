import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FiInfo } from 'react-icons/fi';

export default function LogConsole({ logs = [], maxHeight = '200px', showTimestamp = true }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 设置日志级别对应的样式
  const getLogStyle = (level) => {
    switch (level) {
      case 'error':
        return 'text-red-500 dark:text-red-400';
      case 'warn':
        return 'text-yellow-500 dark:text-yellow-400';
      case 'success':
        return 'text-green-500 dark:text-green-400';
      case 'info':
      default:
        return 'text-gray-700 dark:text-gray-300';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full bg-gray-100 dark:bg-gray-800 rounded-lg shadow-sm"
    >
      <div className="p-2 bg-gray-200 dark:bg-gray-700 rounded-t-lg flex items-center">
        <FiInfo className="mr-2" />
        <h3 className="text-sm font-medium">连接状态日志</h3>
      </div>
      
      <div 
        className="p-2 overflow-y-auto text-xs font-mono"
        style={{ maxHeight }}
      >
        {logs.length === 0 ? (
          <div className="text-center py-4 text-gray-500 dark:text-gray-400">
            还没有日志信息
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log, index) => (
              <div key={index} className={getLogStyle(log.level)}>
                {showTimestamp && (
                  <span className="text-gray-500 dark:text-gray-400 mr-2">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                )}
                <span>{log.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
