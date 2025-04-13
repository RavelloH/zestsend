import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import FileTransfer from '../../components/FileTransfer';
import Chat from '../../components/Chat';
import IPMap from '../../components/IPMap';
import LogConsole from '../../components/LogConsole';
import ConnectionStatus from '../../components/ConnectionStatus';
import MediaChat from '../../components/MediaChat'; 
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
  
  // 延迟状态变量
  const [httpLatency, setHttpLatency] = useState(null);
  const [p2pLatency, setP2pLatency] = useState(null);
  
  // 连接状态跟踪
  const [httpPollingActive, setHttpPollingActive] = useState(false);
  const [p2pConnectionActive, setP2pConnectionActive] = useState(false);
  const [dataChannelActive, setDataChannelActive] = useState(false);

  // 房间已满错误
  const [roomFullError, setRoomFullError] = useState(false);

  // 媒体流状态
  const [localMediaStream, setLocalMediaStream] = useState(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState(null);

  // 初始化状态标志
  const [initialized, setInitialized] = useState(false);
  const [peerRegistered, setPeerRegistered] = useState(false);
  
  // 使用useRef防止重复初始化
  const initRef = useRef(false);
  const registrationRef = useRef(false);
  
  // 保存connection对象的引用
  const connectionRef = useRef(null);

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

  // 确保在peerId更新后重新获取IP信息
  useEffect(() => {
    if (peerId && roomId) {
      fetchIPInfo();
    }
  }, [peerId, roomId]);

  // 初始化房间逻辑
  useEffect(() => {
    // 使用ref防止重复初始化，即使在严格模式下
    if (!roomId || initRef.current) return;
    
    // 立即标记为已初始化，防止重复执行
    initRef.current = true;

    const initRoom = async () => {
      try {
        addLog(`正在初始化房间: ${roomId}`);
        const res = await fetch(`/api/room/init?roomId=${roomId}`);
        const data = await res.json();

        if (res.ok) {
          setIsInitiator(data.isInitiator);
          addLog(`您是${data.isInitiator ? '创建者' : '加入者'}`);
          
          // 初始化连接
          initConnection(data.isInitiator);
          
          // 标记为已初始化
          setInitialized(true);
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
  }, [roomId]); // 仅依赖roomId，通过ref控制重复执行

  // 初始化WebRTC连接
  const initConnection = async (isInitiator) => {
    try {
      // 生成随机的peerId
      const generatedPeerId = `zestsend-${roomId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setPeerId(generatedPeerId);
      
      // 设置peerId后立即获取IP信息(异步)
      setTimeout(() => {
        fetchIPInfo(); // 异步获取IP信息，不阻塞连接初始化
      }, 100);
      
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
      connectionRef.current = p2pConnection; // 保存连接对象到ref
      
      // 为媒体流注册回调
      p2pConnection.onMediaStream((stream, type) => {
        addLog(`收到对方${type || ''}媒体流`, 'info');
        setRemoteMediaStream(stream);
      });
      
      // 向服务器注册peerId，只在未注册时进行
      if (!registrationRef.current) {
        await registerPeer(generatedPeerId, isInitiator);
        registrationRef.current = true;
        setPeerRegistered(true);
      }
      
      // 启动轮询 - 让所有用户都启动轮询
      startPolling(generatedPeerId, p2pConnection, isInitiator);
    } catch (error) {
      console.error('Connection initialization error:', error);
      addLog(`初始化连接出错: ${error.message}`, 'error');
    }
  };

  // 向服务器注册peerId
  const registerPeer = async (peerId, isInitiator) => {
    // 防止重复注册
    if (registrationRef.current) {
      addLog(`Peer ID 已经注册，跳过注册过程`, 'info');
      return true;
    }
    
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
      registrationRef.current = true;
      setPeerRegistered(true);
      return true;
    } catch (error) {
      addLog(`注册Peer ID失败: ${error.message}`, 'error');
      return false;
    }
  };

  // 获取IP信息
  const fetchIPInfo = async () => {
    try {
      // 确保有peerId和roomId时才请求
      if (!peerId || !roomId) {
        console.log('延迟获取IP信息: 等待peerId和roomId');
        return; 
      }

      // 附带roomId和peerId参数请求IP信息，使服务器直接存储到Redis
      const res = await fetch(`/api/ip?roomId=${roomId}&peerId=${peerId}`);
      
      if (res.ok) {
        const ipData = await res.json();
        console.log('获取到IP信息:', ipData);
        setIpInfo(ipData);
        
        // 已在服务器直接存储到Redis，不需要额外的存储请求
        addLog(`获取到IP信息: ${ipData.city}, ${ipData.country_name}`, 'info');
      } else {
        throw new Error('获取IP信息失败，服务器返回错误');
      }
    } catch (error) {
      console.error('Error fetching IP info:', error);
      addLog(`获取IP信息失败: ${error.message}`, 'warn');
    }
  };

  // 开始轮询检查远程Peer
  const startPolling = (peerId, p2pConnection, isInitiator) => {
    // 防止重复启动轮询
    if (httpPollingActive || pollingId) {
      addLog(`轮询已经在运行中，跳过`, 'info');
      return pollingId;
    }
    
    addLog(`开始轮询检查对方连接状态...`);
    setHttpPollingActive(true);
    
    // 跟踪内部连接状态，确保轮询内部立即感知连接状态变化
    const connectionState = { isConnected: connected };
    
    // 防止日志重复的变量
    const logState = {
      lastRemotePeerId: null,
      lastConnectionAttempt: 0,
      connectionCheckLogShown: false,
      lastErrorTime: 0
    };
    
    const interval = setInterval(async () => {
      // 更新内部连接状态引用以获取最新状态
      connectionState.isConnected = connected;
      
      // 如果已经连接，减少轮询频率
      if (connectionState.isConnected) {
        clearInterval(interval);
        addLog(`已连接，切换到低频轮询模式`, 'info');
        
        // 使用更低频率的轮询保持IP信息更新
        const slowInterval = setInterval(async () => {
          try {
            // 只获取IP信息，不尝试连接
            const res = await fetch(`/api/signaling/poll?roomId=${roomId}&peerId=${peerId}`);
            const data = await res.json();
            
            if (res.ok) {
              // 轮询获取对方最新的IP信息
              if (data.remotePeerId && data.remotePeerId !== remotePeerId) {
                setRemotePeerId(data.remotePeerId);
              }
              
              // 更新对方IP信息
              if (data.ipInfo) {
                console.log('轮询获取到对方IP信息:', data.ipInfo);
                setPeerIpInfo(data.ipInfo);
              } else if (data.peerIPInfo) {
                console.log('轮询获取到对方从我们这获取的IP信息:', data.peerIPInfo);
                setPeerIpInfo(data.peerIPInfo);
              } else {
                // 如果没有拿到对方的IP信息，尝试主动获取
                fetchPeerIPInfo();
              }
            }
          } catch (error) {
            console.error('IP polling error:', error);
          }
        }, 10000); // 10秒一次
        
        setPollingId(slowInterval);
        return slowInterval;
      }
      
      try {
        // 记录HTTP轮询开始时间
        const pollStartTime = Date.now();
        
        const res = await fetch(`/api/signaling/poll?roomId=${roomId}&peerId=${peerId}`);
        const data = await res.json();
        
        // 计算HTTP轮询延迟
        const pollEndTime = Date.now();
        const latency = pollEndTime - pollStartTime;
        setHttpLatency(latency);
        
        if (res.ok) {
          // 即使已连接，仍然更新remotePeerId，确保两端都能看到对方ID
          if (data.remotePeerId && data.remotePeerId !== remotePeerId) {
            setRemotePeerId(data.remotePeerId);
          }
          
          // 更新对方IP信息 - 添加额外的验证逻辑
          if (data.ipInfo && 
              JSON.stringify(data.ipInfo) !== JSON.stringify(peerIpInfo) && 
              (ipInfo?.ip !== data.ipInfo.ip)) { // 确保不是自己的IP
            
            setPeerIpInfo(data.ipInfo);
            console.log("更新对方IP信息:", data.ipInfo);
          } else if (data.peerIPInfo && 
                     JSON.stringify(data.peerIPInfo) !== JSON.stringify(peerIpInfo) &&
                     (ipInfo?.ip !== data.peerIPInfo.ip)) { // 确保不是自己的IP
            
            // 使用对方返回的自己的IP信息作为对方的IP信息
            setPeerIpInfo(data.peerIPInfo);
            console.log("使用远程自身IP信息:", data.peerIPInfo);
          }
          
          // 已连接状态下的处理
          if (connectionState.isConnected) {
            // 如果已连接，只更新远程ID和IP信息，不尝试重新连接
            return; // 直接返回，避免尝试建立新连接
          }
          
          // 未连接状态下，检查是否有可用的远程Peer进行连接
          if (data.remotePeerId) {
            // 检查是否是新的远程对等方ID - 只有在变化时才输出日志
            const isNewRemotePeer = data.remotePeerId !== logState.lastRemotePeerId;
            if (isNewRemotePeer) {
              addLog(`发现对方 Peer ID: ${data.remotePeerId}`);
              setRemotePeerId(data.remotePeerId);
              logState.lastRemotePeerId = data.remotePeerId;
            }
            
            // 严格检查连接状态，禁止在已连接状态下尝试连接
            if (p2pConnection && !connectionState.isConnected && !connected) {
              // 检查p2p连接对象的连接状态
              const isAlreadyConnected = p2pConnection.isConnected && p2pConnection.isConnected();
              
              if (isAlreadyConnected) {
                // 只在首次检测到活跃连接时输出日志，避免重复日志
                if (!logState.connectionCheckLogShown) {
                  addLog(`检测到已有活跃连接，跳过连接尝试`, 'info');
                  logState.connectionCheckLogShown = true;
                }
                return;
              }
              
              // 限制连接尝试的频率
              const now = Date.now();
              const timeSinceLastAttempt = now - logState.lastConnectionAttempt;
              const minAttemptInterval = 5000; // 5秒内不重复尝试连接
              
              if (timeSinceLastAttempt < minAttemptInterval) {
                return; // 静默跳过，不记录日志
              }
              
              const delayTime = data.connectionPriority === 'high' ? 0 : 1000;
              
              setTimeout(() => {
                // 再次检查连接状态，以防在延迟期间已连接
                if (!connected && !connectionState.isConnected) {
                  if (p2pConnection.isConnected && p2pConnection.isConnected()) {
                    return; // 已连接，静默返回
                  }
                  
                  addLog(`尝试连接到对方...`);
                  logState.lastConnectionAttempt = Date.now();
                  
                  p2pConnection.connect(data.remotePeerId)
                    .then(() => {
                      // 成功后立即更新内部引用状态，防止其他轮询尝试重复连接
                      connectionState.isConnected = true;
                      logState.connectionCheckLogShown = false; // 重置标志，允许下一次连接时显示日志
                    })
                    .catch(err => {
                      // 如果是"已存在连接"错误，可以忽略
                      if (!err.message.includes('already connected') && 
                          !err.message.includes('Connection already exists')) {
                        addLog(`连接尝试失败: ${err.message}`, 'error');
                      }
                    });
                }
              }, delayTime);
            }
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        // 限制错误日志的频率
        const now = Date.now();
        if (!logState.lastErrorTime || now - logState.lastErrorTime > 10000) {
          addLog(`轮询出错: ${error.message}`, 'warn');
          logState.lastErrorTime = now;
        }
      }
    }, 3000);
    
    setPollingId(interval);
    return interval;
  };

  // 获取对方IP信息 - 改进版，直接从Redis获取
  const fetchPeerIPInfo = async () => {
    if (!remotePeerId || !roomId) {
      console.log('无法获取对方IP信息：缺少remotePeerId或roomId');
      return;
    }
    
    try {
      console.log(`主动获取对方IP信息: roomId=${roomId}, remotePeerId=${remotePeerId}`);
      const res = await fetch(`/api/signaling/ip?roomId=${roomId}&peerId=${remotePeerId}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.ipInfo) {
          console.log('获取到对方IP信息:', data.ipInfo);
          setPeerIpInfo(data.ipInfo);
          addLog(`已获取对方位置信息: ${data.ipInfo.city}, ${data.ipInfo.country_name}`, 'info');
        } else {
          console.log('获取对方IP信息失败：Redis中无数据');
        }
      } else {
        console.error('获取对方IP信息请求失败');
      }
    } catch (error) {
      console.error('Error fetching peer IP info:', error);
    }
  };

  // 处理Peer连接
  const handlePeerConnected = (conn) => {
    addLog(`已与对方建立连接!`, 'success');
    // 立即设置连接状态，防止轮询继续尝试连接
    setConnected(true);
    setP2pConnectionActive(true);
    setDataChannelActive(true);
    
    // 确保远程PeerId在连接时被设置（加入对方ID）
    if (conn && conn.peer && !remotePeerId) {
      setRemotePeerId(conn.peer);
      addLog(`已获取对方ID: ${conn.peer}`, 'info');
    }
    
    // 尝试获取对方IP信息
    fetchPeerIPInfo();
    
    // 使用ref获取最新的连接对象
    if (connectionRef.current) {
      // 确保延迟测量在连接建立后开始，并添加一个小延迟确保连接稳定
      setTimeout(() => {
        addLog('开始测量连接延迟...', 'info');
        connectionRef.current.startLatencyMeasurement((latency) => {
          setP2pLatency(latency);
        });
      }, 1000);
    } else {
      addLog('无法开始延迟测量：连接对象不可用', 'warn');
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
    setP2pLatency(null); // 重置P2P延迟
    
    // 停止延迟测量
    if (connectionRef.current) {
      connectionRef.current.stopLatencyMeasurement();
    }
    
    // 当连接断开时，重新启动轮询以尝试重新连接
    // 确保只有在已经停止轮询时才重新启动
    if (!httpPollingActive && !pollingId && peerId) {
      addLog(`连接断开，重新开始轮询...`, 'info');
      startPolling(peerId, connection, isInitiator);
    }
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
              <div className={`px-3 py-1 rounded-full text-sm ${connected 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'}`}>
                {connected ? '已连接' : '等待连接...'}
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md"
            >
              <ConnectionStatus
                httpPolling={httpPollingActive}
                p2pConnection={p2pConnectionActive}
                dataChannel={dataChannelActive}
                isInitiator={isInitiator}
                peerId={peerId}
                remotePeerId={remotePeerId}
                httpLatency={httpLatency}
                p2pLatency={p2pLatency}
              />
            </motion.div>

            {/* 聊天 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md"
            >
              <Chat 
                onSendMessage={handleSendMessage} 
                messages={messages}
              />
            </motion.div>

            {/* 日志 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.5 }}
              className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md"
            >
              <h2 className="text-lg font-medium mb-2">连接日志</h2>
              <LogConsole logs={logs} />
            </motion.div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
