import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import FileTransfer from '../../components/FileTransfer';
import Chat from '../../components/Chat';
import IPMap from '../../components/IPMap';
import LogConsole from '../../components/LogConsole';
import ConnectionStatus from '../../components/ConnectionStatus';
import MediaChat from '../../components/MediaChat'; // 新增导入
import { P2PConnection } from '../../lib/webrtc';
import { motion } from 'framer-motion';
import { FiUsers, FiRefreshCw, FiCopy, FiCheck, FiMonitor } from 'react-icons/fi';

export default function Room() {
  const router = useRouter();
  const { id: roomId } = router.query;
  
  const [connection, setConnection] = useState(null);
  const [connected, setConnected] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [remotePeerId, setRemotePeerId] = useState('');
  const [isInitiator, setIsInitiator] = useState(false);
  const [messages, setMessages] = useState([]);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [ipInfo, setIpInfo] = useState(null);
  const [peerIpInfo, setPeerIpInfo] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [videoStream, setVideoStream] = useState(null);
  const [pollingId, setPollingId] = useState(null);
  
  // 连接状态跟踪
  const [httpPollingActive, setHttpPollingActive] = useState(false);
  const [p2pConnectionActive, setP2pConnectionActive] = useState(false);
  const [dataChannelActive, setDataChannelActive] = useState(false);

  // 添加状态来跟踪房间已满错误
  const [roomFullError, setRoomFullError] = useState(false);

  // 添加媒体流状态
  const [localMediaStream, setLocalMediaStream] = useState(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState(null);

  // 添加日志
  const addLog = useCallback((message, level = 'info') => {
    const log = {
      message,
      level,
      timestamp: Date.now()
    };
    setLogs(logs => [...logs, log]);
    console.log(`[${level.toUpperCase()}] ${message}`);
  }, []);

  // 初始化房间逻辑
  useEffect(() => {
    if (!roomId) return;

    const initRoom = async () => {
      try {
        addLog(`正在初始化房间: ${roomId}`);
        const res = await fetch(`/api/room/init?roomId=${roomId}`);
        const data = await res.json();

        if (res.ok) {
          setIsInitiator(data.isInitiator);
          addLog(`您是${data.isInitiator ? '创建者' : '加入者'}`);
          
          // 获取IP信息
          fetchIPInfo();
          
          // 初始化连接
          initConnection(data.isInitiator);
        } else {
          // 检查是否是房间已满的错误
          if (data.roomFull) {
            addLog(`房间 ${roomId} 已满，无法加入`, 'error');
            setRoomFullError(true);
          } else {
            addLog(`初始化房间失败: ${data.message}`, 'error');
          }
        }
      } catch (error) {
        console.error('Room initialization error:', error);
        addLog(`初始化房间出错: ${error.message}`, 'error');
      }
    };

    initRoom();

    return () => {
      // 清理连接
      if (connection) {
        connection.close();
      }
      // 清理轮询
      if (pollingId) {
        clearInterval(pollingId);
      }
    };
  }, [roomId]);

  // 初始化WebRTC连接
  const initConnection = async (isInitiator) => {
    try {
      // 生成随机的peerId
      const generatedPeerId = `zestsend-${roomId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setPeerId(generatedPeerId);
      
      addLog(`正在创建P2P连接对象...`);
      const p2pConnection = new P2PConnection(
        roomId,
        generatedPeerId,
        handlePeerConnected,
        handleDataReceived,
        handleStreamReceived,
        handlePeerDisconnected,
        addLog
      );
      
      addLog(`初始化P2P连接...`);
      await p2pConnection.init();
      setConnection(p2pConnection);
      
      // 为媒体流注册回调
      p2pConnection.onMediaStream((stream, type) => {
        addLog(`收到对方${type || ''}媒体流`, 'info');
        setRemoteMediaStream(stream);
      });
      
      // 向服务器注册peerId
      await registerPeer(generatedPeerId, isInitiator);
      
      // 如果不是创建者，尝试连接到已存在的peer
      if (!isInitiator) {
        startPolling(generatedPeerId, p2pConnection);
      }
    } catch (error) {
      console.error('Connection initialization error:', error);
      addLog(`初始化连接出错: ${error.message}`, 'error');
    }
  };

  // 向服务器注册peerId
  const registerPeer = async (peerId, isInitiator) => {
    try {
      addLog(`正在向服务器注册Peer ID...`);
      const res = await fetch('/api/signaling/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          peerId,
          isInitiator
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || '注册Peer ID失败');
      }
      
      addLog(`Peer ID注册成功`, 'success');
      return true;
    } catch (error) {
      addLog(`注册Peer ID失败: ${error.message}`, 'error');
      return false;
    }
  };

  // 开始轮询检查远程Peer
  const startPolling = (peerId, p2pConnection) => {
    addLog(`开始轮询检查对方连接状态...`);
    setHttpPollingActive(true);
    
    const interval = setInterval(async () => {
      // 如果已经连接，减少轮询频率
      if (connected) {
        clearInterval(interval);
        // 使用更低频率的轮询保持IP信息更新
        const slowInterval = setInterval(async () => {
          try {
            // 只获取IP信息，不尝试连接
            const res = await fetch(`/api/signaling/poll?roomId=${roomId}&peerId=${peerId}`);
            const data = await res.json();
            
            if (res.ok && data.ipInfo && data.ipInfo.ip !== (peerIpInfo?.ip || '')) {
              setPeerIpInfo(data.ipInfo);
            }
          } catch (error) {
            console.error('IP polling error:', error);
          }
        }, 10000); // 10秒一次
        
        setPollingId(slowInterval);
        return slowInterval;
      }
      
      try {
        const res = await fetch(`/api/signaling/poll?roomId=${roomId}&peerId=${peerId}`);
        const data = await res.json();
        
        if (res.ok && data.remotePeerId) {
          // 严格检查：确保不是自己
          if (data.remotePeerId === peerId) {
            addLog(`检测到尝试连接到自己(${peerId})，已忽略此连接请求`, 'warn');
            return;
          }
          
          if (data.remotePeerId !== remotePeerId) {
            addLog(`发现对方 Peer ID: ${data.remotePeerId}`);
            setRemotePeerId(data.remotePeerId);
            
            // 连接到远程Peer
            if (p2pConnection && !connected) {
              addLog(`尝试连接到对方...`);
              p2pConnection.connect(data.remotePeerId)
                .then(() => {
                  // 连接成功，不需要在handlePeerConnected中重复设置，因为那里已有逻辑
                })
                .catch(err => {
                  addLog(`连接尝试失败: ${err.message}`, 'error');
                });
            }
            
            // 获取对方IP信息
            if (data.ipInfo) {
              setPeerIpInfo(data.ipInfo);
            }
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        addLog(`轮询出错: ${error.message}`, 'warn');
      }
    }, 3000);
    
    setPollingId(interval);
    return interval;
  };

  // 获取IP信息
  const fetchIPInfo = async () => {
    try {
      const res = await fetch('/api/ip');
      if (res.ok) {
        const ipData = await res.json();
        setIpInfo(ipData);
        
        // 将IP信息存储到服务器
        await fetch('/api/signaling/ip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            roomId,
            peerId,
            ipInfo: ipData
          }),
        });
      }
    } catch (error) {
      console.error('Error fetching IP info:', error);
      addLog(`获取IP信息失败: ${error.message}`, 'warn');
    }
  };

  // 处理Peer连接
  const handlePeerConnected = (conn) => {
    addLog(`已与对方建立连接!`, 'success');
    setConnected(true);
    setP2pConnectionActive(true);
    setDataChannelActive(true);
    
    // 尝试获取对方IP信息
    fetchPeerIPInfo();
    
    // 安排多次尝试以确保获取到IP信息
    const retryTimes = [1000, 2000, 5000, 10000];
    retryTimes.forEach(delay => {
      setTimeout(() => {
        if (!peerIpInfo) {
          fetchPeerIPInfo();
        }
      }, delay);
    });
    
    // 设置轮询定时获取对方IP信息
    const ipRefreshInterval = setInterval(() => {
      fetchPeerIPInfo();
    }, 15000); // 每15秒尝试一次
    
    setIpRefreshIntervalId(ipRefreshInterval);
  };

  // 获取对方IP信息
  const fetchPeerIPInfo = async () => {
    if (!roomId) return;
    
    try {
      // 方法1: 通过房间查询所有对方IP信息
      const res = await fetch(`/api/signaling/ip?roomId=${roomId}&peerId=${peerId}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.ipInfoAvailable && data.ipInfo) {
          setPeerIpInfo(data.ipInfo);
          return true;
        }
      }
      
      // 方法2: 如果我们知道对方ID，直接查询
      if (remotePeerId) {
        const directRes = await fetch(`/api/signaling/ip?roomId=${roomId}&remotePeerId=${remotePeerId}`);
        
        if (directRes.ok) {
          const data = await directRes.json();
          if (data.ipInfoAvailable && data.ipInfo) {
            setPeerIpInfo(data.ipInfo);
            return true;
          }
        }
      }
      
      // 方法3: 从房间信息中获取对方信息
      const roomRes = await fetch(`/api/signaling/room-info?roomId=${roomId}`);
      
      if (roomRes.ok) {
        const roomData = await roomRes.json();
        if (roomData.room && roomData.room.peers) {
          // 找到不是自己的peer
          const otherPeer = roomData.room.peers.find(p => p.id !== peerId);
          if (otherPeer && otherPeer.ipInfo) {
            setPeerIpInfo(otherPeer.ipInfo);
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error fetching peer IP info:', error);
      return false;
    }
  };

  // 处理接收到的数据
  const handleDataReceived = (data) => {
    switch (data.type) {
      case 'message':
        addLog(`收到消息: ${data.content.substring(0, 20)}${data.content.length > 20 ? '...' : ''}`);
        setMessages(prev => [
          ...prev, 
          {
            text: data.content,
            timestamp: Date.now(),
            isSelf: false
          }
        ]);
        break;
        
      case 'file-start':
        addLog(`对方开始发送文件: ${data.fileName}`);
        break;
        
      case 'file-progress':
        // 这里不添加日志，以避免日志过多
        break;
        
      case 'file-complete':
        addLog(`文件接收完成: ${data.fileName}`, 'success');
        setReceivedFiles(prev => [
          ...prev,
          {
            id: data.fileId,
            name: data.fileName,
            size: data.fileSize,
            type: data.fileType,
            data: data.fileData
          }
        ]);
        break;
        
      default:
        console.log('Received data:', data);
    }
  };

  // 处理接收到的媒体流
  const handleStreamReceived = (stream) => {
    addLog(`收到对方的屏幕共享流`, 'info');
    setVideoStream(stream);
  };

  // 处理Peer断开连接
  const handlePeerDisconnected = () => {
    addLog(`与对方的连接已断开`, 'warn');
    setConnected(false);
    setRemotePeerId('');
    setPeerIpInfo(null);
    setVideoStream(null);
    setP2pConnectionActive(false);
    setDataChannelActive(false);
  };

  // 发送消息
  const handleSendMessage = (message) => {
    if (!connection || !connected) {
      addLog('无法发送消息: 未连接到对方', 'error');
      return;
    }
    
    const success = connection.sendMessage(message);
    
    if (success) {
      setMessages(prev => [
        ...prev, 
        {
          text: message,
          timestamp: Date.now(),
          isSelf: true
        }
      ]);
    }
  };

  // 发送文件
  const handleSendFile = async (file) => {
    if (!connection || !connected) {
      addLog('无法发送文件: 未连接到对方', 'error');
      return false;
    }
    
    addLog(`开始发送文件: ${file.name}`);
    
    try {
      await connection.sendFile(file);
      return true;
    } catch (error) {
      addLog(`发送文件失败: ${error.message}`, 'error');
      return false;
    }
  };

  // 共享屏幕
  const handleShareScreen = async () => {
    if (!connection || !connected) {
      addLog('无法共享屏幕: 未连接到对方', 'error');
      return;
    }
    
    try {
      if (screenSharing) {
        // 停止共享
        if (videoStream) {
          videoStream.getTracks().forEach(track => track.stop());
          setVideoStream(null);
        }
        setScreenSharing(false);
        addLog('屏幕共享已停止');
      } else {
        // 开始共享
        const stream = await connection.shareScreen();
        setVideoStream(stream);
        setScreenSharing(true);
        addLog('屏幕共享已开始', 'success');
      }
    } catch (error) {
      addLog(`屏幕共享失败: ${error.message}`, 'error');
    }
  };

  // 处理媒体流改变
  const handleMediaChange = (type, enabled, stream) => {
    if (!connection || !connected) {
      addLog(`无法${enabled ? '开启' : '关闭'}${type}: 未连接到对方`, 'error');
      return;
    }
    
    // 处理所有媒体关闭
    if (type === 'all' && !enabled) {
      if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => track.stop());
      }
      setLocalMediaStream(null);
      
      if (connection) {
        connection.stopMediaStream('audio');
        connection.stopMediaStream('video');
      }
      
      return;
    }
    
    // 处理单个媒体类型
    if (enabled && stream) {
      setLocalMediaStream(stream);
      connection.sendMediaStream(stream, type);
    } else {
      if (localMediaStream) {
        // 只停止特定类型的轨道
        localMediaStream.getTracks()
          .filter(track => type === 'audio' ? track.kind === 'audio' : track.kind === 'video')
          .forEach(track => track.stop());
      }
      
      // 如果关闭后没有其他活跃轨道，清除本地流
      if (localMediaStream && localMediaStream.getTracks().length === 0) {
        setLocalMediaStream(null);
      }
      
      connection.stopMediaStream(type);
    }
  };

  // 复制房间链接
  const copyRoomLink = () => {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  // 如果房间ID未加载，显示加载界面
  if (!roomId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-xl text-gray-600 dark:text-gray-300">
            加载中...
          </div>
        </div>
      </Layout>
    );
  }

  // 修改渲染逻辑，显示房间已满的错误
  if (roomFullError) {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-20 p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div className="text-center">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold mb-2">房间已满</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              房间 #{roomId} 已经有两个用户，无法加入。请尝试其他房间号。
            </p>
            <button 
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition duration-200"
            >
              返回首页
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* 房间状态栏 */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold flex items-center">
                <FiUsers className="mr-2" />
                房间 #{roomId}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {isInitiator ? '您创建了这个房间' : '您加入了这个房间'}
              </p>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                <div className={`px-3 py-1 rounded-full text-sm ${connected 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'}`}
                >
                  {connected ? '已连接' : '等待连接...'}
                </div>
                
                {connected && connectionLatency !== null && (
                  <div className={`px-2 py-1 rounded-md text-xs font-mono ${
                    connectionLatency < 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200' :
                    connectionLatency < 150 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' :
                    connectionLatency < 300 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200' :
                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                  }`}>
                    {connectionLatency < 0 ? '超时' : `${connectionLatency}ms`}
                  </div>
                )}
              </div>
              
              <button 
                onClick={copyRoomLink} 
                className="flex items-center space-x-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                {copySuccess ? <FiCheck className="mr-1" /> : <FiCopy className="mr-1" />}
                <span>{copySuccess ? '已复制' : '复制链接'}</span>
              </button>
              
              {connected && (
                <button 
                  onClick={handleShareScreen} 
                  className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg transition-colors ${
                    screenSharing 
                      ? 'bg-red-500 hover:bg-red-600 text-white' 
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  <FiMonitor className="mr-1" />
                  <span>{screenSharing ? '停止共享' : '共享屏幕'}</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* 视频流显示 */}
        {videoStream && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 bg-black rounded-lg overflow-hidden shadow-lg"
          >
            <video
              ref={ref => {
                if (ref && videoStream) {
                  ref.srcObject = videoStream;
                  ref.play().catch(e => console.error('Error playing video:', e));
                }
              }}
              autoPlay
              playsInline
              className="w-full max-h-[50vh] object-contain"
            />
          </motion.div>
        )}
        
        {/* 主要内容 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧 - 文件传输 */}
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6"
            >
              <h2 className="text-lg font-medium mb-4">文件传输</h2>
              <FileTransfer 
                onSendFile={handleSendFile} 
                receivedFiles={receivedFiles}
              />
            </motion.div>
            
            {/* 媒体聊天 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6"
            >
              <MediaChat 
                connection={connection}
                connected={connected}
                onMediaChange={handleMediaChange}
                localStream={localMediaStream}
                remoteStream={remoteMediaStream}
                addLog={addLog}
              />
            </motion.div>
            
            {/* IP地图 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6"
            >
              <h2 className="text-lg font-medium mb-4">连接地图</h2>
              <IPMap ipInfo={ipInfo} peerIpInfo={peerIpInfo} />
            </motion.div>
          </div>
          
          {/* 右侧 - 聊天、连接状态和日志 */}
          <div className="space-y-6">
            {/* 连接状态 */}
            <ConnectionStatus
              httpPolling={httpPollingActive}
              p2pConnection={p2pConnectionActive}
              dataChannel={dataChannelActive}
              isInitiator={isInitiator}
              peerId={peerId}
              remotePeerId={remotePeerId}
            />
            
            {/* 聊天 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md"
            >
              <Chat 
                onSendMessage={handleSendMessage} 
                messages={messages}
              />


















}  );    </Layout>      </div>        </div>          </div>            </motion.div>              <LogConsole logs={logs} />              <h2 className="text-lg font-medium mb-2">连接日志</h2>            >              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md"              transition={{ duration: 0.3, delay: 0.4 }}              animate={{ opacity: 1, y: 0 }}              initial={{ opacity: 0, y: 20 }}            <motion.div            {/* 日志 */}                        </motion.div>        </div>
      </div>
    </Layout>
  );
}
