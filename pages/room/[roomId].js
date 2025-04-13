import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { nanoid } from 'nanoid';
import FileTransfer from '../../components/FileTransfer';
import Chat from '../../components/Chat';
import ConnectionStatus from '../../components/ConnectionStatus';

// 动态导入地图组件，避免SSR问题
const PeerInfo = dynamic(() => import('../../components/PeerInfo'), {
  ssr: false
});

// 改进的STUN/TURN服务器配置
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.sipnet.net:3478' },
    { urls: 'stun:stun.ideasip.com:3478' },
    // 免费TURN服务器
    {
      urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
      credential: 'webrtc',
      username: 'webrtc'
    },
    {
      urls: 'turn:numb.viagenie.ca:3478',
      credential: 'muazkh',
      username: 'webrtc@live.com'
    },
    {
      urls: 'turn:relay.metered.ca:80',
      credential: 'openrelayproject',
      username: 'openrelayproject'
    }
  ]
};

// 创建或获取唯一会话ID
const getSessionId = () => {
  if (typeof window === 'undefined') return null;
  
  let sessionId = localStorage.getItem('zestsend_session_id');
  if (!sessionId) {
    sessionId = nanoid(10); // 生成10位随机ID
    localStorage.setItem('zestsend_session_id', sessionId);
  }
  return sessionId;
};

export default function Room() {
  const router = useRouter();
  const { roomId } = router.query;
  const [connectionStatus, setConnectionStatus] = useState('waiting'); // waiting, connecting, connected, error
  const [statusMessage, setStatusMessage] = useState('准备中...');
  const [errorMessage, setErrorMessage] = useState('');
  const [peerInfo, setPeerInfo] = useState(null);
  const [localIpInfo, setLocalIpInfo] = useState(null);
  const [isInitiator, setIsInitiator] = useState(false); // 是否发起连接
  const [roomUsers, setRoomUsers] = useState([]); // 房间内的用户会话ID
  const [forceInitiator, setForceInitiator] = useState(false); // 强制作为发起方
  
  // Refs
  const socketRef = useRef();
  const peerRef = useRef();
  const fileChannelRef = useRef();
  const chatChannelRef = useRef();
  const connectAttemptsRef = useRef(0);
  const maxConnectAttempts = 5; // 增加最大尝试次数
  const pendingCandidatesRef = useRef([]); // 存储待处理的ICE候选
  const remoteDescriptionSetRef = useRef(false); // 跟踪远程描述是否已设置
  const connectionTimeoutRef = useRef(null); // 超时引用
  const sessionIdRef = useRef(getSessionId()); // 唯一会话ID
  const remoteSessionIdRef = useRef(null); // 远程会话ID
  const isSocketConnectedRef = useRef(false); // 跟踪socket连接状态
  
  // 记录连接诊断信息
  const [connectionDiagnostics, setConnectionDiagnostics] = useState({
    lastInitiator: null,
    lastConnectionAttempt: null,
    remoteSessionId: null,
    sessionCompare: null,
    shouldInitiateReason: null,
    forceConnect: false
  });
  
  // 获取本地IP信息
  useEffect(() => {
    const fetchIpInfo = async () => {
      try {
        console.log('开始获取本地IP信息');
        const res = await fetch('/api/geolocation');
        if (res.ok) {
          const data = await res.json();
          console.log('获取到本地IP信息:', data);
          setLocalIpInfo(data);
        } else {
          console.error('获取IP信息失败，状态码:', res.status);
        }
      } catch (err) {
        console.error('获取IP信息失败:', err);
      }
    };
    
    fetchIpInfo();
  }, []);
  
  // 确定是否应该是发起方
  const determineInitiator = useCallback((sessionId, allSessions) => {
    console.log('判断发起方', { sessionId, allSessions });
    
    // 如果强制作为发起方
    if (forceInitiator) {
      const reason = '手动强制作为发起方';
      console.log(reason);
      setConnectionDiagnostics(prev => ({
        ...prev,
        lastInitiator: true,
        shouldInitiateReason: reason
      }));
      return true;
    }
    
    // 如果只有一个用户，不需要发起连接
    if (!allSessions || allSessions.length <= 1) {
      const reason = '房间中只有一个用户，等待他人加入';
      console.log(reason);
      setConnectionDiagnostics(prev => ({
        ...prev,
        lastInitiator: false,
        shouldInitiateReason: reason
      }));
      return false;
    }
    
    // 确保allSessions是数组
    const sessions = Array.isArray(allSessions) ? allSessions : Object.keys(allSessions);
    if (sessions.length < 2) {
      const reason = '无法确定房间中的其他用户';
      console.log(reason);
      setConnectionDiagnostics(prev => ({
        ...prev,
        lastInitiator: false,
        shouldInitiateReason: reason
      }));
      return false;
    }
    
    // 确保当前会话ID在列表中
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId);
    }
    
    // 对会话ID进行排序，确保在所有客户端上结果一致
    const sortedSessions = [...sessions].sort();
    console.log('排序后的会话ID:', sortedSessions);
    
    // 计算字典序位置
    const position = sortedSessions.indexOf(sessionId);
    
    // 奇数位置的用户作为发起方（0是偶数，1是奇数，等等）
    // 这确保房间中总是有发起方和非发起方
    const shouldInitiate = position % 2 === 1;
    
    const reason = `会话ID在排序后位于第${position}位（${shouldInitiate ? '奇数位置作为发起方' : '偶数位置作为非发起方'}）`;
    console.log(reason);
    
    setConnectionDiagnostics(prev => ({
      ...prev,
      lastInitiator: shouldInitiate,
      sessionCompare: `当前: ${sessionId} 在位置 ${position}`,
      allSessions: sortedSessions,
      shouldInitiateReason: reason
    }));
    
    return shouldInitiate;
  }, [forceInitiator]);
  
  // 创建并配置新的Peer连接
  const createPeerConnection = useCallback((shouldInitiate = false) => {
    // 如果强制作为发起方，覆盖传入的参数
    if (forceInitiator) {
      shouldInitiate = true;
    }
    
    console.log(`创建P2P连接，发起方:`, shouldInitiate);
    
    // 记录连接尝试
    const timestamp = new Date().toISOString();
    setConnectionDiagnostics(prev => ({
      ...prev,
      lastConnectionAttempt: timestamp,
      lastInitiator: shouldInitiate,
      forceConnect: forceInitiator
    }));
    
    // 增加尝试次数
    connectAttemptsRef.current += 1;
    
    // 检查是否超过最大尝试次数
    if (connectAttemptsRef.current > maxConnectAttempts) {
      setConnectionStatus('error');
      setErrorMessage(`连接尝试失败，已尝试 ${maxConnectAttempts} 次。请点击"强制连接"按钮重试。`);
      return null;
    }
    
    // 更新UI状态
    setConnectionStatus('connecting');
    setStatusMessage(`正在建立连接...(尝试 ${connectAttemptsRef.current}/${maxConnectAttempts})`);
    
    // 清理现有连接
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    // 清除可能存在的超时
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }
    
    // 重置状态追踪变量
    remoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
    
    try {
      // 创建新的Peer连接 - 添加额外配置增强连接成功率
      const peer = new Peer({
        initiator: shouldInitiate,
        trickle: true, // 开启ICE trickling
        config: iceServers,
        reconnectTimer: 3000, // 重连定时器
        iceTransportPolicy: 'all', // 使用所有可用的ICE候选
        sdpTransform: (sdp) => {
          // 添加调试日志，但不修改SDP
          console.log('处理SDP:', sdp.substring(0, 100) + '...');
          return sdp; // 返回原始SDP，不进行修改
        }
      });
      
      // 设置连接超时 - 延长超时时间
      connectionTimeoutRef.current = setTimeout(() => {
        if (connectionStatus !== 'connected' && peer && !peer.destroyed) {
          console.log('连接超时，尝试重新连接');
          peer.destroy();
          createPeerConnection(shouldInitiate);
        }
      }, 20000);
      
      // 信号事件 - 发送给对方
      peer.on('signal', data => {
        if (!socketRef.current || !isSocketConnectedRef.current) {
          console.log('Socket未连接，暂存信号');
          pendingCandidatesRef.current.push(data);
          return;
        }
        
        console.log(`生成信号:`, data.type || 'candidate');
        
        // 如果交换的是offer/answer，记录更明确的日志
        if (data.type === 'offer' || data.type === 'answer') {
          console.log(`生成${data.type}信号，准备建立连接`);
        }
        
        // 发送信号给房间中的其他人，并指明远程会话ID
        socketRef.current.emit('signal', {
          roomId,
          signal: data,
          targetSessionId: remoteSessionIdRef.current
        });
      });
      
      // 连接建立事件
      peer.on('connect', () => {
        console.log('WebRTC连接已建立! 数据通道已开启');
        clearTimeout(connectionTimeoutRef.current);
        setConnectionStatus('connected');
        setStatusMessage('已连接');
        connectAttemptsRef.current = 0; // 重置尝试计数
        
        // 发起方创建数据通道
        if (shouldInitiate) {
          try {
            // 文件传输通道 - 使用更可靠的配置
            const fileChannel = peer.createDataChannel('file-transfer', {
              ordered: true, // 保证顺序
              maxRetransmits: 30 // 最大重传次数
            });
            
            fileChannel.binaryType = 'arraybuffer'; // 优化二进制传输
            
            fileChannel.onopen = () => console.log('文件通道已打开');
            fileChannel.onerror = (err) => console.error('文件通道错误:', err);
            fileChannelRef.current = fileChannel;
            
            // 聊天通道
            const chatChannel = peer.createDataChannel('chat', {
              ordered: true
            });
            chatChannel.onopen = () => console.log('聊天通道已打开');
            chatChannel.onerror = (err) => console.error('聊天通道错误:', err);
            chatChannelRef.current = chatChannel;
            
            console.log('数据通道已创建');
          } catch (err) {
            console.error('创建数据通道出错:', err);
          }
        }
        
        // 发送本地IP信息 - 无论是否为发起方都发送
        if (localIpInfo && socketRef.current && isSocketConnectedRef.current) {
          console.log('发送本地IP信息:', localIpInfo);
          socketRef.current.emit('peer-info', { roomId, info: localIpInfo });
        } else {
          console.warn('无法发送本地IP信息:', {
            hasLocalInfo: !!localIpInfo,
            hasSocket: !!socketRef.current,
            isSocketConnected: isSocketConnectedRef.current
          });
        }
      });
      
      // 数据通道事件（接收方）
      peer.on('datachannel', channel => {
        console.log(`收到数据通道: ${channel.label}`);
        
        if (channel.label === 'file-transfer') {
          channel.binaryType = 'arraybuffer'; // 优化二进制传输
          fileChannelRef.current = channel;
        } else if (channel.label === 'chat') {
          chatChannelRef.current = channel;
        }
      });
      
      // 错误处理
      peer.on('error', err => {
        console.error('WebRTC错误:', err.message);
        clearTimeout(connectionTimeoutRef.current);
        
        // 检查是否是致命错误
        const isFatalError = err.message.includes('ICE failed') || 
                             err.message.includes('Connection failed');
        
        // 尝试重连
        if (connectionStatus !== 'connected' && 
            connectAttemptsRef.current < maxConnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, connectAttemptsRef.current - 1), 16000);
          console.log(`将在 ${delay}ms 后尝试重新连接`);
          setTimeout(() => createPeerConnection(shouldInitiate), delay);
        } else if (isFatalError) {
          setConnectionStatus('error');
          setErrorMessage(`连接错误: ${err.message}。请点击"强制连接"按钮尝试作为发起方连接。`);
        }
      });
      
      // 连接关闭
      peer.on('close', () => {
        console.log('WebRTC连接关闭');
        clearTimeout(connectionTimeoutRef.current);
        
        if (connectionStatus === 'connected') {
          setConnectionStatus('error');
          setErrorMessage('连接已关闭，对方可能已离开');
        }
      });
      
      // 监控ICE连接状态
      peer._pc.oniceconnectionstatechange = () => {
        const state = peer._pc.iceConnectionState;
        console.log('ICE连接状态变化:', state);
        
        // 当ICE连接状态为connected或completed时，如果P2P连接没有建立，手动触发连接逻辑
        if ((state === 'connected' || state === 'completed') && 
            connectionStatus !== 'connected') {
          console.log('ICE连接已成功建立，但P2P连接尚未触发connect事件');
          
          // 如果15秒内peer.connect事件没触发，但ICE连接成功，则手动设置为已连接
          setTimeout(() => {
            if (connectionStatus !== 'connected' && 
                (peer._pc.iceConnectionState === 'connected' || 
                 peer._pc.iceConnectionState === 'completed')) {
              console.log('手动设置连接状态为已连接');
              setConnectionStatus('connected');
              setStatusMessage('已连接 (ICE连接成功)');
              
              // 如果是发起方，确保数据通道已创建
              if (shouldInitiate && !fileChannelRef.current) {
                try {
                  console.log('手动创建数据通道');
                  // 创建文件通道
                  const fileChannel = peer.createDataChannel('file-transfer', {
                    ordered: true
                  });
                  fileChannel.binaryType = 'arraybuffer';
                  fileChannelRef.current = fileChannel;
                  
                  // 创建聊天通道
                  const chatChannel = peer.createDataChannel('chat', {
                    ordered: true
                  });
                  chatChannelRef.current = chatChannel;
                  
                  // 发送本地IP信息
                  if (localIpInfo && socketRef.current) {
                    socketRef.current.emit('peer-info', { roomId, info: localIpInfo });
                  }
                } catch (err) {
                  console.error('手动创建数据通道失败:', err);
                }
              }
            }
          }, 5000); // 给予5秒缓冲时间等待connect事件
        }
      };
      
      // 添加信令状态监控
      peer._pc.onsignalingstatechange = () => {
        console.log('信令状态变化:', peer._pc.signalingState);
        // 当信令状态为stable时，表示offer/answer交换完成
        if (peer._pc.signalingState === 'stable') {
          console.log('信令交换已完成，等待ICE连接建立');
        }
      };
      
      // 添加连接状态监控
      peer._pc.onconnectionstatechange = () => {
        console.log('连接状态变化:', peer._pc.connectionState);
        // 当连接状态为connected时，如果UI状态不是connected，则更新
        if (peer._pc.connectionState === 'connected' && connectionStatus !== 'connected') {
          console.log('PeerConnection连接已建立，更新UI状态');
          setConnectionStatus('connected');
          setStatusMessage('已连接');
        }
      };
      
      // 保存并返回创建的peer对象
      peerRef.current = peer;
      return peer;
      
    } catch (err) {
      console.error('创建Peer对象失败:', err);
      setConnectionStatus('error');
      setErrorMessage(`创建连接失败: ${err.message}`);
      return null;
    }
  }, [connectionStatus, localIpInfo, roomId, forceInitiator]);
  
  // 处理收到的信号
  const handleReceivedSignal = useCallback((signal, senderSessionId) => {
    if (!signal) {
      console.error('收到无效信号');
      return;
    }
    
    console.log(`收到信号:`, signal.type || 'candidate', '来自会话:', senderSessionId);
    
    // 存储远程会话ID
    if (senderSessionId && senderSessionId !== sessionIdRef.current) {
      remoteSessionIdRef.current = senderSessionId;
      
      setConnectionDiagnostics(prev => ({
        ...prev,
        remoteSessionId: senderSessionId
      }));
    }
    
    // 如果peer对象不存在，创建一个非发起方的连接
    if (!peerRef.current) {
      console.log('收到信号但Peer未创建，创建非发起方连接');
      createPeerConnection(false);
    }
    
    // 处理ICE候选
    if (!signal.type && peerRef.current) {
      console.log('处理ICE候选', { 
        candidate: signal.candidate ? signal.candidate.substr(0, 50) + '...' : 'none',
        hasRemoteDesc: remoteDescriptionSetRef.current
      });
      
      // 如果远程描述尚未设置，保存候选者以后处理
      if (!remoteDescriptionSetRef.current) {
        console.log('保存ICE候选，等待远程描述设置');
        pendingCandidatesRef.current.push(signal);
      } else {
        try {
          peerRef.current.signal(signal);
        } catch (err) {
          console.error('处理ICE候选失败:', err);
        }
      }
      return;
    }
    
    // 处理SDP offer/answer
    if ((signal.type === 'offer' || signal.type === 'answer') && peerRef.current) {
      console.log(`处理${signal.type}信号，准备建立连接`, {
        signalingState: peerRef.current._pc?.signalingState || 'unknown'
      });
      
      try {
        peerRef.current.signal(signal);
        remoteDescriptionSetRef.current = true;
        
        // 处理之前保存的ICE候选
        console.log(`处理 ${pendingCandidatesRef.current.length} 个待处理ICE候选`);
        pendingCandidatesRef.current.forEach(candidate => {
          try {
            peerRef.current.signal(candidate);
          } catch (err) {
            console.error('处理保存的ICE候选失败:', err);
          }
        });
        pendingCandidatesRef.current = [];
      } catch (err) {
        console.error('处理SDP失败:', err);
      }
      
      // 设置一个额外的状态检查定时器
      setTimeout(() => {
        if (connectionStatus !== 'connected' && peerRef.current) {
          console.log('信号处理后状态检查，ICE状态:', 
                      peerRef.current._pc?.iceConnectionState,
                      '连接状态:', 
                      peerRef.current._pc?.connectionState);
        }
      }, 3000);
    }
  }, [createPeerConnection, connectionStatus]);

  // 设置WebSocket连接和事件处理
  useEffect(() => {
    if (!roomId) return;
    
    // 防止重复创建socket连接
    if (socketRef.current) {
      console.log('Socket已存在，跳过创建');
      return;
    }
    
    // 获取完整的服务器URL，确保正确处理基本路径
    let socketURL = window.location.origin;
    if (process.env.NODE_ENV === 'development') {
      socketURL = 'http://localhost:3000';
    }
    
    console.log('连接到信令服务器:', socketURL);
    
    // 创建Socket连接 - 配置为仅使用HTTP轮询
    const socketOptions = {
      path: '/api/socketio',
      reconnectionAttempts: 10,      // 重连尝试次数
      reconnectionDelay: 1000,       // 首次重连延迟
      reconnectionDelayMax: 10000,   // 最大重连延迟
      timeout: 30000,                // 连接超时
      transports: ['polling'],       // 仅使用HTTP轮询
      upgrade: false,                // 禁用传输升级
      forceNew: true,                // 强制新连接
      autoConnect: true,             // 自动连接
      rejectUnauthorized: false,     // 允许自签名证书
      query: {                       // 添加会话ID作为查询参数
        sessionId: sessionIdRef.current,
        roomId: roomId,              // 同时传递房间ID
        _t: Date.now()               // 添加时间戳防止缓存问题
      }
    };
    
    console.log('Socket.io 配置:', socketOptions);
    
    // 初始化连接
    const socket = io(socketURL, socketOptions);
    socketRef.current = socket;
    
    // 全局监听连接事件
    socket.io.on('error', (err) => {
      console.error('Socket.io 低级错误:', err);
      setStatusMessage(`连接错误: ${err.message}，尝试重新连接...`);
    });
    
    // 添加传输错误处理
    socket.io.engine.on('transportError', (err) => {
      console.error('传输错误:', err);
      setStatusMessage(`传输错误: ${err.message}，尝试其他传输方式...`);
      
      // 记录客户端详细信息用于调试
      console.log('客户端详细信息:', {
        userAgent: navigator.userAgent,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language || 'unknown',
        screenSize: `${window.screen.width}x${window.screen.height}`,
        sessionId: sessionIdRef.current
      });
    });
    
    // 连接事件
    socket.on('connect', () => {
      console.log('信令服务器已连接, socket ID:', socket.id, '传输类型:', socket.io.engine.transport.name);
      isSocketConnectedRef.current = true;
      setStatusMessage('已连接到服务器，正在加入房间...');
      
      // 检查是否有会话错误
      socket.emit('check-session-error', { sessionId: sessionIdRef.current });
      
      // 首先注册会话ID
      socket.emit('register-session', sessionIdRef.current);
      
      // 设置定期心跳检测 - 增加频率，在serverless环境中保持连接
      const heartbeatInterval = setInterval(() => {
        if (socket.connected) {
          try {
            const startTime = Date.now();
            socket.emit('heartbeat');
            socket.once('heartbeat-response', (data) => {
              const latency = Date.now() - startTime;
              console.log(`信令服务器延迟: ${latency}ms, 传输: ${data.transport || 'unknown'}`);
            });
          } catch (err) {
            console.error('发送心跳时出错:', err);
          }
        }
      }, 30000); // 每30秒发送一次心跳，更频繁以保持连接
      
      // 保存清理函数的引用
      socket.heartbeatInterval = heartbeatInterval;
      
      // 加入房间，发送会话ID
      socket.emit('join-room', roomId, sessionIdRef.current);
      
      // 如果之前有断线重连的情况，尝试恢复会话状态
      if (remoteSessionIdRef.current) {
        console.log('尝试恢复之前的会话连接');
        socket.emit('reconnect-attempt', {
          sessionId: sessionIdRef.current,
          roomId: roomId,
          remoteSessionId: remoteSessionIdRef.current
        });
      }
      
      // 发送暂存的信号
      if (pendingCandidatesRef.current.length > 0 && peerRef.current) {
        console.log('发送暂存的信号:', pendingCandidatesRef.current.length);
        pendingCandidatesRef.current.forEach(signal => {
          socket.emit('signal', {
            roomId,
            signal,
            targetSessionId: remoteSessionIdRef.current
          });
        });
        pendingCandidatesRef.current = [];
      }
    });
    
    // 监听会话注册响应
    socket.on('session-registered', (data) => {
      console.log('会话注册确认:', data);
      
      // 可以在这里执行一些会话成功注册后的逻辑
    });
    
    // 监听会话错误检查响应
    socket.on('session-error-status', (data) => {
      console.log('会话错误状态:', data);
      
      if (data.found) {
        console.log('发现会话错误记录, 需要重新连接');
        
        // 可以选择自动处理错误
        if (data.data && data.data.error === 'session_id_unknown') {
          // 在UI中显示错误，或者自动重新连接
          setErrorMessage(`检测到会话错误，可能需要重置连接。错误类型: ${data.data.error}`);
        }
      }
    });
    
    // 监听会话错误通知
    socket.on('session-error-detected', (data) => {
      console.log('服务器检测到会话错误:', data);
      
      // 提示用户会话有问题
      setErrorMessage(`检测到会话问题: ${data.error}。请尝试重置会话或重新连接。`);
      
      // 您可以添加自动恢复逻辑，或者让用户手动操作
    });
    
    // 房间状态事件 - 简化以确保一致处理
    socket.on('room-status', ({ shouldInitiate, usersCount, allSessions, resumedSession, reconnected }) => {
      console.log('房间状态:', { shouldInitiate, usersCount, allSessions, resumedSession, reconnected });
      
      // 存储房间用户信息
      setRoomUsers(allSessions || []);
      
      // 直接使用服务器分配的发起方状态
      setIsInitiator(shouldInitiate);
      setConnectionDiagnostics(prev => ({
        ...prev,
        lastInitiator: shouldInitiate,
        shouldInitiateReason: `服务器分配的发起方: ${shouldInitiate ? '是' : '否'}`,
        resumedSession: resumedSession || false,
        reconnected: reconnected || false
      }));
      
      // 根据房间状态创建连接
      if (usersCount === 2) {  // 只有当房间有两人时才建立连接
        if (shouldInitiate) {
          // 需要主动发起连接
          setStatusMessage(resumedSession ? '恢复连接中...' : '作为发起方，开始连接对方...');
          // 销毁现有连接并创建新的，除非是恢复会话且已连接
          if (peerRef.current && (connectionStatus !== 'connected' || !resumedSession)) {
            peerRef.current.destroy();
            peerRef.current = null;
          }
          
          // 如果没有活跃的连接，创建新的
          if (!peerRef.current) {
            createPeerConnection(true);
          }
        } else {
          // 等待对方连接
          setStatusMessage(resumedSession ? '等待对方恢复连接...' : '作为接收方，等待对方连接...');
          // 确保我们没有尝试发起连接
          if (peerRef.current && peerRef.current.initiator && !resumedSession) {
            peerRef.current.destroy();
            peerRef.current = null;
          }
          
          // 如果没有活跃的连接且不是恢复会话，创建非发起方连接
          if (!peerRef.current && !resumedSession) {
            createPeerConnection(false);
          }
        }
      } else if (usersCount < 2) {
        setStatusMessage('等待他人加入房间...');
      }
    });
    
    // 有用户加入事件
    socket.on('user-joined', (data) => {
      // 安全地获取会话ID
      const sessionId = data && data.sessionId;
      console.log('有用户加入房间, 会话ID:', sessionId || '未知');
      
      // 存储对方的会话ID
      if (sessionId && sessionId !== sessionIdRef.current) {
        remoteSessionIdRef.current = sessionId;
        
        setConnectionDiagnostics(prev => ({
          ...prev,
          remoteSessionId: sessionId
        }));
      }
    });
    
    // 信令事件 - 优化处理逻辑
    socket.on('signal', (data) => {
      // 检查signal是否存在
      if (!data || !data.signal) {
        console.error('收到无效信号数据:', data);
        return;
      }
      
      // 忽略来自自己的信号
      if (data.sessionId === sessionIdRef.current) {
        console.log('忽略来自自己的信号');
        return;
      }
      
      console.log('收到信号:', data.signal.type || 'candidate');
      
      handleReceivedSignal(data.signal, data.sessionId);
    });
    
    // 对方断开连接
    socket.on('peer-disconnected', ({ sessionId }) => {
      console.log('对方已断开连接, 会话ID:', sessionId);
      
      if (sessionId === remoteSessionIdRef.current) {
        if (connectionStatus === 'connected') {
          setConnectionStatus('error');
          setErrorMessage('对方已断开连接');
        }
        
        // 清理现有连接
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        
        // 重新请求房间状态
        socket.emit('join-room', roomId, sessionIdRef.current);
      }
    });
    
    // 收到对方IP信息
    socket.on('peer-info', (info) => {
      console.log('收到对方信息:', info);
      if (info && Object.keys(info).length > 0) {
        setPeerInfo(info);
      } else {
        console.warn('收到空的对方信息');
      }
    });
    
    // 房间已满
    socket.on('room-full', () => {
      setConnectionStatus('error');
      setErrorMessage('房间已满，无法加入');
    });
    
    // 连接错误
    socket.on('connect_error', (err) => {
      console.error('连接服务器出错:', err);
      isSocketConnectedRef.current = false;
      
      // 记录详细错误信息
      const errorDetails = {
        message: err.message,
        type: err.type,
        description: err.description,
        context: err.context,
        time: new Date().toISOString(),
        sessionId: sessionIdRef.current,
        roomId: roomId,
        attempts: socket.io.reconnectionAttempts,
        opts: socket.io.opts
      };
      console.log('连接错误详情:', errorDetails);
      
      // 更新UI
      setConnectionStatus('error');
      setErrorMessage(`连接服务器失败: ${err.message || '未知错误'}`);
      
      // 检查是否是会话ID错误，这种情况下尝试清除会话并重新连接
      if (err.message && (
          err.message.includes('Session ID unknown') || 
          err.message.includes('session') || 
          err.message.includes('sid')
      )) {
        console.log('检测到会话错误，尝试清除会话ID并重新连接');
        
        // 生成新的会话ID
        const newSessionId = nanoid(10);
        console.log(`重新生成会话ID: ${sessionIdRef.current} -> ${newSessionId}`);
        sessionIdRef.current = newSessionId;
        localStorage.setItem('zestsend_session_id', newSessionId);
        
        // 更新错误消息，提供更具体的指导
        setErrorMessage(`会话ID错误，已生成新ID: ${newSessionId.substring(0,8)}。请点击"重置会话"按钮重试连接。`);
        
        // 不要自动重连，而是让用户手动操作，这样更可控
      }
      
      // 尝试使用不同的传输方式
      if (socket.io && socket.io.engine && socket.io.engine.transport) {
        const currentTransport = socket.io.engine.transport.name;
        console.log(`当前传输方式 ${currentTransport} 失败，尝试其他传输方式`);
        
        if (currentTransport === 'websocket') {
          setStatusMessage('WebSocket 连接失败，尝试使用 HTTP 长轮询...');
          socket.io.opts.transports = ['polling']; // 仅使用长轮询
        }
      }
    });
    
    // 重连中
    socket.on('reconnecting', (attemptNumber) => {
      console.log(`尝试重连 (${attemptNumber})...`);
      isSocketConnectedRef.current = false;
      setStatusMessage(`正在尝试重新连接服务器... (${attemptNumber}/10)`);
    });
    
    // 重连失败
    socket.on('reconnect_failed', () => {
      console.error('重连失败，已达到最大尝试次数');
      setConnectionStatus('error');
      setErrorMessage(`无法连接到服务器，请刷新页面或检查网络连接`);
    });
    
    // 重连成功
    socket.on('reconnect', () => {
      console.log('重新连接到服务器');
      isSocketConnectedRef.current = true;
      setStatusMessage('已重新连接到服务器');
      socket.emit('join-room', roomId, sessionIdRef.current);
    });
    
    // 断开连接
    socket.on('disconnect', (reason) => {
      console.log('与服务器断开连接, 原因:', reason);
      isSocketConnectedRef.current = false;
      if (connectionStatus !== 'connected') {
        setStatusMessage('与服务器连接断开，尝试重连中...');
      }
    });
    
    // 组件卸载时清理
    return () => {
      console.log('清理房间组件');
      
      // 检查是否真的离开页面
      const isReallyLeaving = document.visibilityState === 'hidden' || 
                             (!location.pathname.includes(`/room/${roomId}`));
      
      if (isReallyLeaving) {
        if (socketRef.current) {
          // 清理心跳检测
          if (socketRef.current.heartbeatInterval) {
            clearInterval(socketRef.current.heartbeatInterval);
          }
          
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        isSocketConnectedRef.current = false;
      }
    };
  }, [roomId, createPeerConnection, handleReceivedSignal, connectionStatus]);

  // 测试信令服务器连接
  const testConnection = () => {
    if (!socketRef.current || !isSocketConnectedRef.current) {
      setStatusMessage('Socket未连接，无法测试连接');
      return;
    }
    
    console.log('测试信令服务器连接');
    setStatusMessage('正在测试信令服务器连接...');
    
    // 发送测试请求
    socketRef.current.emit('connection-test', { roomId });
  };
  
  // 添加一个新函数用于清除并重新连接
  const resetAndReconnect = () => {
    // 生成新的会话ID
    const newSessionId = nanoid(10);
    console.log(`重置会话ID: ${sessionIdRef.current} -> ${newSessionId}`);
    sessionIdRef.current = newSessionId;
    localStorage.setItem('zestsend_session_id', newSessionId);
    
    // 清理现有连接
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    if (socketRef.current) {
      // 清理心跳
      if (socketRef.current.heartbeatInterval) {
        clearInterval(socketRef.current.heartbeatInterval);
      }
      
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    // 重置计数器
    connectAttemptsRef.current = 0;
    
    // 清除所有缓存的信息
    remoteSessionIdRef.current = null; // 重要：清除远程会话ID缓存
    pendingCandidatesRef.current = [];
    remoteDescriptionSetRef.current = false;
    
    // 更新状态
    setConnectionStatus('waiting');
    setStatusMessage('正在重置连接...');
    
    // 重新初始化Socket连接
    setTimeout(() => {
      // 获取完整的服务器URL
      let socketURL = window.location.origin;
      if (process.env.NODE_ENV === 'development') {
        socketURL = 'http://localhost:3000';
      }
      
      // 创建新的Socket连接
      const socket = io(socketURL, {
        path: '/api/socketio',
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 30000,
        transports: ['polling'],
        upgrade: false,
        forceNew: true,
        autoConnect: true,
        rejectUnauthorized: false,
        query: {
          sessionId: newSessionId,
          roomId: roomId,
          reset: 'true',
          _t: Date.now() // 添加时间戳防止缓存问题
        }
      });
      
      socketRef.current = socket;
      
      // 重新注册事件监听器 - 此处简化，实际应该复用代码
      socket.on('connect', () => {
        console.log('已重新连接到信令服务器');
        isSocketConnectedRef.current = true;
        setStatusMessage('已重新连接到服务器，正在加入房间...');
        
        socket.emit('register-session', newSessionId);
        socket.emit('join-room', roomId, newSessionId);
        
        // 设置新的心跳检测
        const heartbeatInterval = setInterval(() => {
          if (socket.connected) {
            socket.emit('heartbeat');
          }
        }, 30000);
        
        socket.heartbeatInterval = heartbeatInterval;
      });
      
      // 添加错误处理器
      socket.on('connect_error', (err) => {
        console.error('重连时出错:', err);
        setErrorMessage(`重连时出错: ${err.message}`);
      });
      
      // 记录成功信息
      console.log('已初始化新的Socket连接');
    }, 1000);
  };
  
  // 作为发起方强制连接
  const forceConnect = (resetSession = false) => {
    // 如果需要重置会话
    if (resetSession) {
      resetAndReconnect();
      return;
    }
    
    // 设置强制发起方标志
    setForceInitiator(true);
    
    console.log('强制作为发起方连接');
    setStatusMessage('强制作为发起方，尝试重新连接...');
    
    // 重置连接尝试计数
    connectAttemptsRef.current = 0;
    
    // 创建新的连接
    setTimeout(() => {
      createPeerConnection(true);
    }, 500);
  };
  
  // 用户手动断开连接
  const handleDisconnect = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    
    isSocketConnectedRef.current = false;
    router.push('/');
  };
  
  // 复制房间链接
  const copyRoomLink = () => {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link)
      .then(() => alert('房间链接已复制到剪贴板!'))
      .catch(err => console.error('复制失败:', err));
  };
  
  // 加载中
  if (!roomId) {
    return <div className="flex justify-center items-center min-h-screen">加载中...</div>;
  }

  return (
    <>
      <Head>
        <title>ZestSend - 房间 {roomId}</title>
      </Head>
      <div className="container mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
        >
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary-600 dark:text-primary-400">
              房间: <span className="font-mono">{roomId}</span>
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              状态: {
                connectionStatus === 'waiting' ? '等待中' :
                connectionStatus === 'connecting' ? '连接中' :
                connectionStatus === 'connected' ? '已连接' : '连接错误'
              }
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={copyRoomLink}
              className="btn-secondary text-sm"
            >
              复制房间链接
            </button>
            <button 
              onClick={handleDisconnect}
              className="btn-secondary text-sm bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-800/40 text-red-700 dark:text-red-400"
            >
              断开连接
            </button>
          </div>
        </motion.div>

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg"
          >
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <p>{errorMessage}</p>
              <div className="flex gap-2">
                <button 
                  onClick={() => forceConnect(true)}
                  className="btn-secondary text-sm bg-red-200 dark:bg-red-800/40 hover:bg-red-300 dark:hover:bg-red-700/40"
                >
                  重置会话
                </button>
                <button 
                  onClick={() => forceConnect(false)}
                  className="btn-secondary text-sm bg-red-200 dark:bg-red-800/40 hover:bg-red-300 dark:hover:bg-red-700/40"
                >
                  强制连接
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {connectionStatus === 'waiting' || connectionStatus === 'connecting' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-10 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-primary-500 animate-pulse"></div>
            </div>
            <h2 className="text-xl font-medium mb-2">{statusMessage}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              房间码: <span className="font-mono font-medium">{roomId}</span>
            </p>
            
            {/* 连接信息 */}
            <div className="mt-4 p-4 bg-gray-50 dark:bg-dark-card rounded-lg text-left text-sm">
              <h3 className="text-base font-medium mb-2">连接信息</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">会话ID:</span>
                  <span className="font-mono">{sessionIdRef.current?.substring(0, 8)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">对方会话:</span>
                  <span className="font-mono">
                    {remoteSessionIdRef.current ? 
                     remoteSessionIdRef.current.substring(0, 8) : '未知'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">房间用户数:</span>
                  <span>{roomUsers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">发起方:</span>
                  <span className={`font-medium ${isInitiator ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    {isInitiator ? '是' : '否'}
                    {forceInitiator && ' (强制)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">连接尝试:</span>
                  <span>{connectAttemptsRef.current} / {maxConnectAttempts}</span>
                </div>
              </div>
            </div>
            
            {/* 添加连接状态组件 */}
            <div className="mt-4">
              <ConnectionStatus 
                socket={socketRef.current} 
                peer={peerRef.current} 
              />
            </div>
            
            {/* 连接操作按钮 */}
            <div className="flex flex-col sm:flex-row justify中心 gap-3 mt-6">
              <button 
                onClick={testConnection}
                className="btn-secondary"
              >
                测试信令连接
              </button>
              <button 
                onClick={forceConnect}
                className="btn-primary"
              >
                强制发起连接
              </button>
            </div>
            
            {/* 高级诊断信息 */}
            <div className="mt-8 text-left">
              <details>
                <summary className="cursor-pointer text-sm font-medium mb-2 text-primary-600 dark:text-primary-400">
                  显示诊断信息
                </summary>
                <div className="mt-2 p-3 bg-gray-100 dark:bg-dark-border rounded-lg overflow-auto max-h-60 text-xs">
                  <pre className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {JSON.stringify({
                      sessionId: sessionIdRef.current,
                      remoteSessionId: remoteSessionIdRef.current,
                      isInitiator,
                      forceInitiator,
                      roomUsers,
                      socketConnected: isSocketConnectedRef.current,
                      pendingCandidates: pendingCandidatesRef.current.length,
                      isRemoteDescriptionSet: remoteDescriptionSetRef.current,
                      connectionAttempts: connectAttemptsRef.current,
                      diagnostics: connectionDiagnostics
                    }, null, 2)}
                  </pre>
                </div>
              </details>
            </div>
          </motion.div>
        ) : connectionStatus === 'connected' ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-2 space-y-6">
              <FileTransfer 
                peer={peerRef.current}
                fileChannel={fileChannelRef.current}
              />
              
              <Chat 
                peer={peerRef.current}
                chatChannel={chatChannelRef.current}
              />
            </div>
            
            <div className="lg:col-span-1 space-y-6">
              <PeerInfo 
                localInfo={localIpInfo}
                remoteInfo={peerInfo}
              />
              
              {/* 连接状态卡片 */}
              <div className="card p-4">
                <h3 className="text-lg font-medium mb-2">连接状态</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">会话ID:</span>
                    <span className="font-mono">{sessionIdRef.current?.substring(0, 8)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Socket ID:</span>
                    <span className="font-mono">{socketRef.current?.id?.substring(0, 8) || '未连接'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">对方会话:</span>
                    <span className="font-mono">
                      {remoteSessionIdRef.current?.substring(0, 8) || '未知'}
                    </span>
                  </div>
                  {peerRef.current && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">ICE状态:</span>
                        <span className="font-medium">{peerRef.current._pc?.iceConnectionState || '未知'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">连接状态:</span>
                        <span className="font-medium">{peerRef.current._pc?.connectionState || '未知'}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>
    </>
  );
}
