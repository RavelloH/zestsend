import { motion } from "framer-motion";
import {
  FiWifi,
  FiCheck,
  FiX,
  FiRefreshCw,
  FiClock,
  FiServer,
  FiGlobe,
} from "react-icons/fi";

export default function ConnectionStatus({
  httpPolling,
  p2pConnection,
  dataChannel,
  isInitiator,
  peerId,
  remotePeerId,
  httpLatency,
  p2pLatency,
  stunServer = null, // 新增STUN服务器状态参数
  className = "",
}) {
  // 定义状态指示器
  const renderStatusIndicator = (
    title,
    isActive,
    icon,
    description,
    latency = null
  ) => (
    <div className="flex items-center space-x-2">
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-full ${
          isActive
            ? "bg-green-100 dark:bg-green-900/50"
            : "bg-yellow-100 dark:bg-yellow-900/50"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <p className="font-medium text-sm flex items-center justify-between text-gray-800 dark:text-gray-200">
          <span className="flex items-center">
            {title}
            <span
              className={`ml-2 inline-block w-2 h-2 rounded-full ${
                isActive ? "bg-green-500" : "bg-yellow-500"
              }`}
            ></span>
          </span>
          {latency !== null && (
            <span
              className={`text-xs font-mono ${getLatencyColorClass(latency)}`}
            >
              {latency}ms
            </span>
          )}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
    </div>
  );

  // 根据延迟值获取颜色类
  const getLatencyColorClass = (latency) => {
    if (latency < 100) return "text-green-500";
    if (latency < 300) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md ${className}`}
    >
      <h2 className="text-lg font-medium mb-4 text-gray-800 dark:text-white">
        连接状态
      </h2>

      <div className="space-y-3">
        {renderStatusIndicator(
          "HTTP 轮询",
          httpPolling,
          <FiServer
            className={httpPolling ? "text-green-500" : "text-yellow-500"}
          />,
          httpPolling ? "服务器轮询正常" : "等待服务器连接...",
          httpLatency
        )}

        {renderStatusIndicator(
          "P2P 连接",
          p2pConnection,
          <FiWifi
            className={p2pConnection ? "text-green-500" : "text-yellow-500"}
          />,
          p2pConnection ? "已建立P2P连接" : "等待P2P连接...",
          p2pLatency
        )}

        {renderStatusIndicator(
          "数据通道",
          dataChannel,
          <FiRefreshCw
            className={dataChannel ? "text-green-500" : "text-yellow-500"}
          />,
          dataChannel ? "数据通道已就绪" : "等待数据通道准备..."
        )}

        {/* 新增STUN服务器状态显示 */}
        {renderStatusIndicator(
          "STUN 服务器",
          stunServer?.active,
          <FiGlobe
            className={
              stunServer?.active ? "text-green-500" : "text-yellow-500"
            }
          />,
          stunServer?.active
            ? stunServer.url
              ? `使用: ${stunServer.url.replace("stun:", "")}`
              : "连接正常"
            : "未使用STUN服务器"
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col space-y-2">
          <div className="text-xs">
            <span className="text-gray-500 dark:text-gray-400">角色:</span>
            <span className="ml-2 font-medium text-gray-800 dark:text-gray-200">
              {isInitiator ? "发起方 👑" : "接收方 👤"}
            </span>
          </div>

          {peerId && (
            <div className="text-xs truncate">
              <span className="text-gray-500 dark:text-gray-400">本地ID:</span>
              <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-800 dark:text-gray-200 text-xs break-all">
                {peerId}
              </span>
            </div>
          )}

          {remotePeerId && (
            <div className="text-xs">
              <span className="text-gray-500 dark:text-gray-400">远程ID:</span>
              <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-800 dark:text-gray-200 text-xs break-all">
                {remotePeerId}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
