import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function ConnectionStatus({ socket, peer }) {
  const [stats, setStats] = useState({
    socketConnected: false,
    peerState: '未初始化',
    iceState: '未初始化',
    dataChannelState: '未初始化',
    peerError: null,
    signalingState: '未初始化',
    connectionState: '未初始化'
  });

  // 定期更新状态信息
  useEffect(() => {
    const updateStats = () => {
      try {
        // Socket连接状态
        const socketConnected = socket?.connected || false;
        
        // Peer连接状态
        let peerState = '未初始化';
        let iceState = '未初始化';
        let dataChannelState = '未初始化';
        let signalingState = '未初始化';
        let connectionState = '未初始化';
        
        if (peer) {
          if (peer._pc) {
            // WebRTC连接已经创建
            peerState = peer.destroyed ? '已销毁' : peer.connected ? '已连接' : '未连接';
            iceState = peer._pc.iceConnectionState || '未知';
            signalingState = peer._pc.signalingState || '未知';
            connectionState = peer._pc.connectionState || '未知';
            
            // 检查数据通道
            if (peer._channel) {
              dataChannelState = peer._channel.readyState || '未知';
            } else if (peer._channels && peer._channels.length > 0) {
              dataChannelState = peer._channels[0].readyState || '未知';
            }
          } else {
            peerState = '已初始化但未创建连接';
          }
        }
        
        setStats({
          socketConnected,
          peerState,
          iceState,
          dataChannelState,
          peerError: peer?.error?.message || null,
          signalingState,
          connectionState
        });
      } catch (err) {
        console.error('获取连接状态失败:', err);
        setStats(prev => ({
          ...prev,
          peerError: err.message
        }));
      }
    };
    
    // 初始更新
    updateStats();
    
    // 设置定期更新
    const interval = setInterval(updateStats, 2000);
    
    return () => clearInterval(interval);
  }, [socket, peer]);
  
  // 生成诊断建议
  const getDiagnosticHelp = () => {
    const suggestions = [];
    
    // 信令服务器问题
    if (!stats.socketConnected) {
      return [
        "信令服务器连接未建立",
        "可能的原因:",
        "- 服务器可能离线",
        "- 防火墙阻止了WebSocket连接",
        "- 网络代理限制了连接",
        "建议:",
        "- 刷新页面重试",
        "- 检查网络连接",
        "- 尝试使用其他网络环境"
      ];
    }
    
    if (stats.peerState !== 'connected' && stats.iceState !== 'connected') {
      return [
        "WebRTC连接建立中，请耐心等待...",
        "连接过程可能需要几十秒",
        "如长时间无变化，可尝试:",
        "- 点击\"强制发起连接\"按钮",
        "- 刷新页面重新连接",
        "- 使用不同的网络环境"
      ];
    }
    
    if (stats.peerState === 'connected' && stats.dataChannelState !== 'open') {
      return [
        "WebRTC连接已建立，但数据通道未打开",
        "建议:",
        "- 等待数据通道建立",
        "- 如长时间无变化，请刷新页面重试"
      ];
    }
    
    if (stats.peerError) {
      return [
        `WebRTC连接错误: ${stats.peerError}`,
        "建议:",
        "- 点击\"强制发起连接\"按钮",
        "- 尝试关闭VPN或代理",
        "- 刷新页面重新连接"
      ];
    }
    
    return suggestions;
  };
  
  // 状态指示器颜色
  const getStatusColor = (type) => {
    switch (type) {
      case 'socket':
        return stats.socketConnected ? 'bg-green-500' : 'bg-red-500';
      case 'peer':
        return stats.peerState === 'connected' ? 'bg-green-500' : 
               stats.peerState === '未初始化' ? 'bg-yellow-500' : 'bg-red-500';
      case 'ice':
        return stats.iceState === 'connected' || stats.iceState === 'completed' ? 'bg-green-500' : 
               stats.iceState === 'checking' ? 'bg-yellow-500' : 
               stats.iceState === '未初始化' ? 'bg-gray-500' : 'bg-red-500';
      case 'dataChannel':
        return stats.dataChannelState === 'open' ? 'bg-green-500' : 
               stats.dataChannelState === 'connecting' ? 'bg-yellow-500' : 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  // 获取更详细的连接状态描述
  const getDetailedPeerStatus = () => {
    if (!peer) return '未初始化';
    
    try {
      // 检查数据通道状态
      const dataChannelState = peer._channel ? peer._channel.readyState : '无通道';
      
      return `${stats.peerState || '未知'}`;
    } catch (e) {
      return peer._pc ? `已初始化` : '未初始化';
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="card p-4"
    >
      <h3 className="text-lg font-medium mb-2 flex items-center">
        <span>连接状态</span>
        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
          诊断工具
        </span>
      </h3>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${getStatusColor('socket')} mr-2`}></div>
            <span className="text-gray-600 dark:text-gray-400">信令服务器:</span>
          </div>
          <span className="font-medium">
            {stats.socketConnected ? `已连接 (HTTP轮询)` : '未连接'}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${getStatusColor('peer')} mr-2`}></div>
            <span className="text-gray-600 dark:text-gray-400">P2P连接:</span>
          </div>
          <span className="font-medium">{getDetailedPeerStatus()}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${getStatusColor('ice')} mr-2`}></div>
            <span className="text-gray-600 dark:text-gray-400">ICE状态:</span>
          </div>
          <span className="font-medium">{stats.iceState}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${getStatusColor('dataChannel')} mr-2`}></div>
            <span className="text-gray-600 dark:text-gray-400">数据通道:</span>
          </div>
          <span className="font-medium">{stats.dataChannelState}</span>
        </div>
        
        {/* 详细信令和连接状态 */}
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-primary-600 dark:text-primary-400">
            高级状态信息
          </summary>
          <div className="mt-2 p-2 bg-gray-50 dark:bg-dark-card rounded-lg text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">信令状态:</span>
              <span className="font-medium">{stats.signalingState}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">连接状态:</span>
              <span className="font-medium">{stats.connectionState}</span>
            </div>
            {stats.peerError && (
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">错误:</span>
                <span className="font-medium text-red-600 dark:text-red-400">{stats.peerError}</span>
              </div>
            )}
          </div>
        </details>
      </div>
      
      {/* 诊断建议 */}
      {getDiagnosticHelp().length > 0 && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/10 text-blue-800 dark:text-blue-300 rounded-lg text-sm">
          <p className="font-medium mb-1">诊断建议:</p>
          <ul className="list-disc list-inside space-y-1">
            {getDiagnosticHelp().map((tip, index) => (
              <li key={index} className={tip.startsWith('-') ? 'ml-4' : ''}>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
