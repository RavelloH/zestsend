import { motion } from 'framer-motion';
import { FiWifi, FiCheck, FiX, FiRefreshCw, FiClock, FiServer } from 'react-icons/fi';

export default function ConnectionStatus({ 
  httpPolling,
  p2pConnection,
  dataChannel,
  isInitiator,
  peerId,
  remotePeerId,
  className = ''
}) {
  // 定义状态指示器
  const renderStatusIndicator = (title, isActive, icon, description) => (
    <div className="flex items-center space-x-2">
      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
        isActive ? 'bg-green-100 dark:bg-green-900/50' : 'bg-yellow-100 dark:bg-yellow-900/50'
      }`}>
        {icon}
      </div>
      <div>
        <p className="font-medium text-sm flex items-center text-gray-800 dark:text-gray-200">
          {title}
          <span className={`ml-2 inline-block w-2 h-2 rounded-full ${
            isActive ? 'bg-green-500' : 'bg-yellow-500'
          }`}></span>
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md ${className}`}
    >
      <h2 className="text-lg font-medium mb-4 text-gray-800 dark:text-white">连接状态</h2>
      
      <div className="space-y-3">
        {renderStatusIndicator(
          'HTTP 轮询', 
          httpPolling, 
          <FiServer className={httpPolling ? 'text-green-500' : 'text-yellow-500'} />, 
          httpPolling ? '服务器轮询正常' : '等待服务器连接...'
        )}
        
        {renderStatusIndicator(
          'P2P 连接', 
          p2pConnection, 
          <FiWifi className={p2pConnection ? 'text-green-500' : 'text-yellow-500'} />, 
          p2pConnection ? '已建立P2P连接' : '等待P2P连接...'
        )}
        
        {renderStatusIndicator(
          '数据通道', 
          dataChannel, 
          <FiRefreshCw className={dataChannel ? 'text-green-500' : 'text-yellow-500'} />, 
          dataChannel ? '数据通道已就绪' : '等待数据通道准备...'
        )}
      </div>
      
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col space-y-2">
          <div className="text-xs">
            <span className="text-gray-500 dark:text-gray-400">角色:</span> 
            <span className="ml-2 font-medium text-gray-800 dark:text-gray-200">
              {isInitiator ? '发起方 👑' : '接收方 👤'}
            </span>
          </div>
          
          {peerId && (
            <div className="text-xs truncate">
              <span className="text-gray-500 dark:text-gray-400">本地ID:</span> 
              <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-800 dark:text-gray-200">
                {peerId.substring(0, 16)}...
              </span>
            </div>
          )}
          
          {remotePeerId && (
            <div className="text-xs truncate">
              <span className="text-gray-500 dark:text-gray-400">远程ID:</span> 
              <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-800 dark:text-gray-200">
                {remotePeerId.substring(0, 16)}...
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
