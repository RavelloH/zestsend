import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import FileTransfer from '../../components/FileTransfer';
import Chat from '../../components/Chat';
import IPMap from '../../components/IPMap';
import LogConsole from '../../components/LogConsole';
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
          addLog(`初始化房间失败: ${data.message}`, 'error');
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
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/signaling/poll?roomId=${roomId}&peerId=${peerId}`);
        const data = await res.json();
        
        if (res.ok && data.remotePeerId && data.remotePeerId !== remotePeerId) {
          addLog(`发现对方 Peer ID: ${data.remotePeerId}`);
          setRemotePeerId(data.remotePeerId);
          
          // 连接到远程Peer
          if (p2pConnection && !connected) {
            addLog(`尝试连接到对方...`);
            p2pConnection.connect(data.remotePeerId);
          }
          
          // 获取对方IP信息
          if (data.ipInfo) {
            setPeerIpInfo(data.ipInfo);
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
    
    // 尝试获取对方IP信息
    fetchPeerIPInfo();
  };

  // 获取对方IP信息
  const fetchPeerIPInfo = async () => {
    try {
      const res = await fetch(`/api/signaling/ip?roomId=${roomId}&peerId=${peerId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ipInfo) {
          setPeerIpInfo(data.ipInfo);
        }
      }
    } catch (error) {
      console.error('Error fetching peer IP info:', error);
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
                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'}`}
              >
                {connected ? '已连接' : '等待连接...'}
              </div>
              
              <button 
                onClick={copyRoomLink} 
                className="btn btn-sm btn-outline"
              >
                {copySuccess ? <FiCheck className="mr-1" /> : <FiCopy className="mr-1" />}
                {copySuccess ? '已复制' : '复制链接'}
              </button>
              
              {connected && (
                <button 
                  onClick={handleShareScreen} 
                  className={`btn btn-sm ${screenSharing ? 'btn-error' : 'btn-info'}`}
                >
                  <FiMonitor className="mr-1" />
                  {screenSharing ? '停止共享' : '共享屏幕'}
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
          
          {/* 右侧 - 聊天和日志 */}
          <div className="space-y-6">
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
            </motion.div>
            
            {/* 日志 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
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
