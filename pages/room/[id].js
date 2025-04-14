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
import { FiUsers, FiRefreshCw, FiCopy, FiCheck, FiMonitor, FiX } from 'react-icons/fi';
import { formatBytes } from '../../lib/utils';

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

  // 在现有的state声明部分添加stunServer状态
  const [stunServer, setStunServer] = useState({
    active: false,
    url: null,
    latency: null
  });
  
  // 新增：添加turnServer状态
  const [turnServer, setTurnServer] = useState({
    active: false,
    url: null,
    latency: null,
    status: "未连接"
  });
  
  // 新增：是否使用TURN中继的状态
  const [usingTurnRelay, setUsingTurnRelay] = useState(false);

  // 增加一个轮询初始化状态标志
  const [pollingInitialized, setPollingInitialized] = useState(false);
  const pollingCheckTimerRef = useRef(null); // 引用存储状态检查计时器

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
        setPollingId(null);
        setHttpPollingActive(false); // 重置HTTP轮询状态
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
      
      // 新增：获取STUN服务器信息
      p2pConnection.onSTUNServerChange((stunInfo) => {
        if (stunInfo) {
          setStunServer({
            active: true,
            url: stunInfo.url,
            latency: stunInfo.latency // 添加延迟信息
          });
          addLog(`使用STUN服务器: ${stunInfo.url}${stunInfo.latency ? ` (延迟: ${stunInfo.latency}ms)` : ''}`, 'info');
        } else {
          setStunServer({
            active: false,
            url: null,
            latency: null
          });
        }
      });
      
      // 新增：获取TURN服务器信息
      p2pConnection.onTURNServerChange((turnInfo) => {
        if (turnInfo) {
          setTurnServer({
            active: turnInfo.active || false,
            url: turnInfo.url,
            latency: turnInfo.latency,
            status: turnInfo.status || "未连接"
          });
          
          if (turnInfo.active) {
            addLog(`使用TURN服务器: ${turnInfo.url}${turnInfo.latency ? ` (延迟: ${turnInfo.latency}ms)` : ''}, 状态: ${turnInfo.status}`, 'info');
          } else if (turnInfo.url) {
            addLog(`TURN服务器准备就绪: ${turnInfo.url}${turnInfo.latency ? ` (延迟: ${turnInfo.latency}ms)` : ''}, 状态: ${turnInfo.status}`, 'info');
          }
        } else {
          setTurnServer({
            active: false,
            url: null,
            latency: null,
            status: "未连接"
          });
        }
      });
      
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

  // 修改 startPolling 函数，确保状态一致性
  const startPolling = (peerId, p2pConnection, isInitiator) => {
    const isConnectedNow = connected; // 捕获当前状态的快照
    
    // 记录当前状态，帮助调试
    console.log('启动轮询检查 - 当前状态:', { 
      httpPollingActive, 
      pollingId: !!pollingId, 
      connected: isConnectedNow 
    });
    
    // 防止重复启动轮询
    if (httpPollingActive && pollingId) {
      addLog(`轮询已经在运行中，跳过`, 'info');
      return pollingId;
    }
    
    // 如果已经连接，不要启动轮询
    if (isConnectedNow) {
      addLog(`已连接状态，不启动轮询`, 'info');
      // 确保状态一致 - 如果已连接就应该关闭轮询
      setHttpPollingActive(false);
      if (pollingId) {
        clearInterval(pollingId);
        setPollingId(null);
      }
      return null;
    }
    
    addLog(`开始轮询检查对方连接状态...`);
    setHttpPollingActive(true);
    
    // 跟踪内部连接状态，确保轮询内部立即感知连接状态变化
    const connectionState = { isConnected: isConnectedNow };
    
    // 防止日志重复的变量
    const logState = {
      lastRemotePeerId: null,
      lastConnectionAttempt: 0,
      connectionCheckLogShown: false,
      lastErrorTime: 0
    };
    
  const interval = setInterval(async () => {
    try {
      // 关键修复点1: 在每次轮询开始前，先检查全局连接状态
      if (connectionState.isConnected || connected) {
        // 如果已经连接，立即停止轮询并清除状态
        clearInterval(interval);
        addLog(`P2P连接已建立，服务器轮询停止`, 'info');
        setPollingId(null);
        setHttpPollingActive(false); // 重置HTTP轮询状态
        return;
      }
      
      // 记录HTTP轮询开始时间
      const pollStartTime = Date.now();
      
      // 如果还未连接，执行轮询
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
  // 重要：标记轮询已初始化，这样状态检查才会开始工作
  setPollingInitialized(true);
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

  // 增强 handlePeerConnected 函数，确保连接后立即停止轮询
  const handlePeerConnected = (conn) => {
    addLog(`已与对方建立连接!`, 'success');
    // 立即设置连接状态
    setConnected(true);
    setP2pConnectionActive(true);
    setDataChannelActive(true);
    
    // 关键修复点2: 连接建立时立即主动停止轮询
    if (pollingId) {
      addLog(`连接已建立，停止服务器轮询`, 'info');
      clearInterval(pollingId);
      setPollingId(null);
      setHttpPollingActive(false); // 明确重置HTTP轮询状态
    }
    
    // 确保远程PeerId在连接时被设置（加入对方ID）
    if (conn && conn.peer && !remotePeerId) {
      setRemotePeerId(conn.peer);
      addLog(`已获取对方ID: ${conn.peer}`, 'info');
    }
    
    // 检查是否正在使用TURN中继
    if (connectionRef.current) {
      const isTurnRelay = connectionRef.current.isUsingTurnRelay();
      
      // 只在状态变化时更新，防止重复设置触发不必要的渲染
      if (isTurnRelay !== usingTurnRelay) {
        setUsingTurnRelay(isTurnRelay);
        
        if (isTurnRelay) {
          addLog(`连接通过TURN服务器中继建立`, 'info');
          
          // 更新TURN服务器状态为"已连接"
          if (connectionRef.current.activeTurnServer) {
            setTurnServer(prev => ({
              ...prev,
              active: true,
              status: "已连接", // 明确显示为已连接
              url: connectionRef.current.activeTurnServer.url,
              latency: connectionRef.current.activeTurnServer.latency
            }));
          }
          
          // 延迟一点时间再发送状态同步，确保连接稳定
          setTimeout(() => {
            if (connectionRef.current) {
              try {
                connectionRef.current.synchronizeTurnState();
              } catch (error) {
                console.error("同步TURN状态失败:", error);
              }
            }
          }, 1000);
        }
      }
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
        
      case 'connection-info':
        // 改进：处理连接信息，避免重复更新，只在状态变化时触发
        if (data.turnServer && data.turnServer.url) {
          // 无论对方是否指示他们使用TURN中继，都更新TURN服务器信息
          setTurnServer(prev => {
            // 只有当URL变化或状态从非活跃变为活跃时才更新，防止重复更新
            if (prev.url !== data.turnServer.url || 
                (!prev.active && data.turnServer.active)) {
              return {
                ...prev,
                url: data.turnServer.url,
                active: true,
                status: "已连接",
                latency: data.turnServer.latency || prev.latency
              };
            }
            return prev;
          });
        }
          
        // 如果对方指示正在使用TURN中继，则我们也应该显示为TURN中继
        if (data.usingTurnRelay && !usingTurnRelay) {
          setUsingTurnRelay(true);
          // 避免重复日志，只在状态变化时记录
          addLog(`检测到连接通过TURN服务器中继`, 'info');
        }
        break;
        
      case 'file-start':
        addLog(`对方开始发送文件: ${data.fileName}`);
        break;
        
      case 'file-progress':
        // 增强进度事件处理
        if (data.progress > 0) {
          // 分发自定义进度事件到全局
          window.dispatchEvent(new CustomEvent('file-progress', { 
            detail: {
              fileId: data.fileId,
              fileName: data.fileName,
              progress: data.progress
            }
          }));
          
          // 每25%记录一次关键进度点
          // if (Math.floor(data.progress) % 25 === 0 || data.progress >= 99.9) {
          //   addLog(`文件接收进度 ${data.fileName}: ${Math.floor(data.progress)}%`);
          // }
        }
        break;
      
      case 'file-complete':
        // 确保文件有效且包含数据
        if (data.fileData && (data.fileData instanceof Blob) && data.fileData.size > 0) {
          addLog(`文件接收完成: ${data.fileName} (${formatBytes(data.fileSize)})`, 'success');
          
          // 添加到收到的文件列表
          setReceivedFiles(prev => [
            ...prev, 
            {
              id: data.fileId || `file-${Date.now()}`,
              name: data.fileName,
              size: data.fileSize,
              type: data.fileType,
              data: data.fileData
            }
          ]);
        } else {
          addLog(`文件接收失败: ${data.fileName} - 无效的文件数据`, 'error');
          console.error('文件数据无效:', data);
        }
        break;
      
      default:
        if (data.type && data.type !== 'ping' && data.type !== 'pong') {
          console.log('Received data:', data);
        }
        break;
    }
  };

  // 处理接收到的媒体流
  const handleStreamReceived = (stream) => {
    addLog(`收到对方的屏幕共享流`, 'info');
    setVideoStream(stream);
  };

  // 修改handlePeerDisconnected函数，确保在P2P连接断开时重新启动轮询
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
    
    // 当连接断开时，无条件重启轮询，不再检查httpPollingActive
    if (peerId) {
      // 先确保没有正在运行的轮询
      if (pollingId) {
        clearInterval(pollingId);
        setPollingId(null);
      }
      
      // 关键修复：确保状态完全重置再重启轮询
      setHttpPollingActive(false);
      addLog(`P2P连接已断开，重新启动服务器轮询...`, 'info');
      
      // 使用setTimeout确保状态更新后再启动轮询
      setTimeout(() => {
        if (!pollingId) {
          startPolling(peerId, connectionRef.current, isInitiator);
        }
      }, 500);
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

  // 发送文件 - 修改为接收文件ID参数
  const handleSendFile = async (file, fileId) => {
    if (!connection || !connected) {
      addLog('无法发送文件: 未连接到对方', 'error');
      return false;
    }
    
    addLog(`开始发送文件: ${file.name}`);
    
    try {
      // 将文件ID传递给WebRTC连接
      await connection.sendFile(file, fileId);
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

  // 添加一个处理断开连接的函数
  const handleDisconnect = () => {
    // 如果已连接，先断开连接
    if (connected && connection) {
      addLog('正在断开连接...', 'info');
      
      // 停止任何媒体流
      if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => track.stop());
        setLocalMediaStream(null);
      }
      
      if (remoteMediaStream) {
        remoteMediaStream.getTracks().forEach(track => track.stop());
        setRemoteMediaStream(null);
      }
      
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
      }
      
      // 关闭P2P连接
      connection.close();
      setConnection(null);
      connectionRef.current = null;
      setConnected(false);
      
      // 停止延迟测量
      if (connectionRef.current) {
        connectionRef.current.stopLatencyMeasurement();
      }
    }
    
    // 清理轮询
    if (pollingId) {
      clearInterval(pollingId);
      setPollingId(null);
    }
    
    // 重置状态
    setHttpPollingActive(false);
    setP2pConnectionActive(false);
    setDataChannelActive(false);
    
    // 添加日志
    addLog(`${connected ? '已断开连接' : '退出房间'}，返回首页`, 'info');
    
    // 延迟一小段时间后导航到首页，确保日志能被看到
    setTimeout(() => {
      router.push('/');
    }, 500);
  };

  // 增加一个检查和修复轮询状态的函数
  const checkAndFixPollingState = useCallback(() => {
    // 只在轮询已初始化后执行自动修复，避免与初始化冲突
    if (!pollingInitialized) {
      return;
    }

    console.log('检查轮询状态 - 当前状态:', { 
      connected, 
      httpPollingActive,
      pollingId: !!pollingId,
      pollingInitialized
    });

    // 如果已连接但轮询还在运行，停止它
    if (connected && httpPollingActive) {
      addLog(`检测到状态不一致：已连接但轮询仍在运行，正在修复...`, 'warn');
      if (pollingId) {
        clearInterval(pollingId);
        setPollingId(null);
      }
      setHttpPollingActive(false);
    }
    
    // 如果未连接且轮询未运行，启动它
    if (!connected && !httpPollingActive && !pollingId && peerId) {
      addLog(`检测到状态不一致：未连接但轮询未运行，正在修复...`, 'warn');
      // 使用延迟确保不会与其他代码冲突
      setTimeout(() => {
        // 再次检查，防止状态在这段时间内发生变化
        if (!connected && !httpPollingActive && !pollingId && peerId) {
          startPolling(peerId, connectionRef.current, isInitiator);
        }
      }, 100);
    }
  }, [connected, httpPollingActive, pollingId, peerId, pollingInitialized]);

  // 添加一个Effect来监控状态并自动修复不一致
  useEffect(() => {
    // 清理之前的计时器
    if (pollingCheckTimerRef.current) {
      clearInterval(pollingCheckTimerRef.current);
      pollingCheckTimerRef.current = null;
    }
    
    // 只有当pollingInitialized为true时才启动状态检查定时器
    if (pollingInitialized) {
      pollingCheckTimerRef.current = setInterval(checkAndFixPollingState, 5000);
      console.log('已启动轮询状态检查定时器');
    }
    
    // 清理函数
    return () => {
      if (pollingCheckTimerRef.current) {
        clearInterval(pollingCheckTimerRef.current);
        pollingCheckTimerRef.current = null;
      }
    };
  }, [checkAndFixPollingState, pollingInitialized]);

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
                data-umami-event="复制房间链接"
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
                  data-umami-event={screenSharing ? "停止屏幕共享" : "开始屏幕共享"}
                >
                  <FiMonitor className="mr-1" />
                  <span>{screenSharing ? '停止共享' : '共享屏幕'}</span>
                </button>
              )}
              {/* 断开连接button */}
              <button
                onClick={handleDisconnect}
                className="flex items-center space-x-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                data-umami-event={connected ? "断开连接" : "退出房间"}
              >
                <FiX className="mr-1" />
                <span>{connected ? '断开连接' : '退出房间'}</span>
              </button>
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
                stunServer={stunServer}
                turnServer={turnServer} // 新增TURN服务器状态
                usingTurnRelay={usingTurnRelay} // 新增是否使用TURN中继
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

            {/* 日志 - 修复了标签错误 */}
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
