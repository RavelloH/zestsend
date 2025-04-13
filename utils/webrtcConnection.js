/**
 * 原生WebRTC连接管理器
 * 使用原生WebRTC API而非simple-peer库，提供更可靠的P2P连接
 */

// 增强的ICE服务器配置
const DEFAULT_ICE_SERVERS = [
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
];

// 调试日志
const debugLog = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[WebRTC ${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
};

export class WebRTCConnection {
  constructor(options = {}) {
    this.config = {
      iceServers: options.iceServers || DEFAULT_ICE_SERVERS,
      iceTransportPolicy: options.iceTransportPolicy || 'all',
      iceCandidatePoolSize: options.iceCandidatePoolSize || 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan'
    };
    
    this.peerConnection = null;
    this.dataChannels = {};
    this.pendingCandidates = [];
    this.isInitiator = !!options.isInitiator;
    this.remoteDescriptionSet = false;
    this.connectionState = 'new';
    this.iceCandidateQueue = [];
    this.iceGatheringComplete = false;
    
    // 事件回调
    this.onSignal = options.onSignal || (() => {});
    this.onConnect = options.onConnect || (() => {});
    this.onData = options.onData || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onError = options.onError || (() => {});
    this.onIceConnectionStateChange = options.onIceConnectionStateChange || (() => {});
    this.onDataChannel = options.onDataChannel || (() => {});
    
    // 性能与可靠性设置
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 2000; // 初始重连延迟(ms)
    
    this._init();
  }
  
  _init() {
    try {
      debugLog('初始化WebRTC连接', { isInitiator: this.isInitiator });
      
      // 创建新的RTCPeerConnection
      this.peerConnection = new RTCPeerConnection(this.config);
      
      // 监听ICE候选
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          debugLog('收集到ICE候选', { 
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address
          });
          
          // 发送ICE候选给对方
          this.onSignal(event.candidate);
        } else {
          debugLog('ICE候选收集完成');
          this.iceGatheringComplete = true;
          
          // 检查并处理队列中的ICE候选
          this._processIceCandidateQueue();
        }
      };
      
      // 监听ICE连接状态变化
      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection.iceConnectionState;
        debugLog('ICE连接状态变化', { state });
        
        this.onIceConnectionStateChange(state);
        
        if (state === 'connected' || state === 'completed') {
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          this.onConnect();
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          this.connectionState = 'disconnected';
          
          // 尝试ICE重启
          if (state === 'failed' && this.reconnectAttempts < this.maxReconnectAttempts) {
            this._attemptReconnect();
          } else if (state === 'closed') {
            this.onClose();
          }
        }
      };
      
      // 监听连接状态变化
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection.connectionState;
        debugLog('连接状态变化', { state });
        
        if (state === 'connected') {
          this.connectionState = 'connected';
          this.onConnect();
        } else if (state === 'failed' || state === 'closed') {
          this.connectionState = 'disconnected';
          if (state === 'failed' && this.reconnectAttempts < this.maxReconnectAttempts) {
            this._attemptReconnect();
          } else if (state === 'closed') {
            this.onClose();
          }
        }
      };
      
      // 监听数据通道
      this.peerConnection.ondatachannel = (event) => {
        this._setupDataChannel(event.channel);
        this.onDataChannel(event.channel);
      };
      
      // 如果是发起方，创建数据通道
      if (this.isInitiator) {
        this._createDataChannels();
        this._createOffer();
      }
      
    } catch (error) {
      debugLog('初始化WebRTC连接失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 创建数据通道
  _createDataChannels() {
    try {
      // 文件传输通道 - 可靠传输
      const fileChannel = this.peerConnection.createDataChannel('file-transfer', {
        ordered: true,
        maxRetransmits: 30
      });
      fileChannel.binaryType = 'arraybuffer'; // 优化二进制传输
      this._setupDataChannel(fileChannel);
      this.dataChannels['file-transfer'] = fileChannel;
      
      // 聊天通道 - 保证有序但优化延迟
      const chatChannel = this.peerConnection.createDataChannel('chat', {
        ordered: true
      });
      this._setupDataChannel(chatChannel);
      this.dataChannels['chat'] = chatChannel;
      
      debugLog('创建数据通道成功', { channels: Object.keys(this.dataChannels) });
      
    } catch (error) {
      debugLog('创建数据通道失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 配置数据通道事件
  _setupDataChannel(channel) {
    const channelName = channel.label;
    
    channel.onopen = () => {
      debugLog(`数据通道已打开: ${channelName}`);
      // 如果任一数据通道打开，认为连接已建立
      this.connectionState = 'connected';
      this.onConnect();
    };
    
    channel.onclose = () => {
      debugLog(`数据通道已关闭: ${channelName}`);
      delete this.dataChannels[channelName];
      
      // 检查是否所有通道都已关闭
      if (Object.keys(this.dataChannels).length === 0) {
        this.connectionState = 'disconnected';
        this.onClose();
      }
    };
    
    channel.onerror = (error) => {
      debugLog(`数据通道错误: ${channelName}`, { error: error.message });
      this.onError(error);
    };
    
    channel.onmessage = (event) => {
      this.onData(event.data, channelName);
    };
    
    this.dataChannels[channelName] = channel;
  }
  
  // 创建Offer
  async _createOffer() {
    try {
      debugLog('创建Offer');
      
      // 设置offer选项
      const offerOptions = {
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        iceRestart: this.reconnectAttempts > 0 // 重连时使用ICE重启
      };
      
      const offer = await this.peerConnection.createOffer(offerOptions);
      await this.peerConnection.setLocalDescription(offer);
      
      // 等待ICE收集完成或超时
      await this._waitForIceCollection();
      
      // 发送完整的offer给对方
      const completeOffer = this.peerConnection.localDescription;
      debugLog('Offer已创建，发送给对方', { type: completeOffer.type });
      this.onSignal(completeOffer);
      
    } catch (error) {
      debugLog('创建Offer失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 等待ICE收集完成
  async _waitForIceCollection() {
    if (this.iceGatheringComplete) return Promise.resolve();
    
    return new Promise((resolve) => {
      const checkState = () => {
        if (this.iceGatheringComplete || 
            this.peerConnection.iceGatheringState === 'complete') {
          this.iceGatheringComplete = true;
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      
      // 设置最长等待时间为5秒
      const timeout = setTimeout(() => {
        debugLog('ICE收集超时，使用当前候选');
        resolve();
      }, 5000);
      
      // 监听ICE收集状态
      this.peerConnection.onicegatheringstatechange = () => {
        if (this.peerConnection.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.iceGatheringComplete = true;
          resolve();
        }
      };
      
      checkState();
    });
  }
  
  // 处理收到的Answer
  async handleAnswer(answer) {
    try {
      if (!this.peerConnection) {
        debugLog('无法处理Answer，连接不存在');
        return;
      }
      
      if (this.peerConnection.signalingState === 'stable') {
        debugLog('信令状态已稳定，忽略Answer');
        return;
      }
      
      debugLog('设置远程Answer');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      this.remoteDescriptionSet = true;
      
      // 处理暂存的ICE候选
      this._processIceCandidateQueue();
      
      debugLog('远程Answer已设置');
    } catch (error) {
      debugLog('处理Answer失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 处理收到的Offer
  async handleOffer(offer) {
    try {
      if (!this.peerConnection) {
        debugLog('无法处理Offer，连接不存在');
        return;
      }
      
      debugLog('收到并设置远程Offer');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      this.remoteDescriptionSet = true;
      
      // 处理暂存的ICE候选
      this._processIceCandidateQueue();
      
      // 创建Answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      // 等待ICE收集完成
      await this._waitForIceCollection();
      
      // 发送完整的answer给对方
      const completeAnswer = this.peerConnection.localDescription;
      debugLog('Answer已创建，发送给对方', { type: completeAnswer.type });
      this.onSignal(completeAnswer);
      
    } catch (error) {
      debugLog('处理Offer失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 处理收到的ICE候选
  async handleIceCandidate(candidate) {
    if (!candidate) return;
    
    // 如果远程描述尚未设置，先暂存候选
    if (!this.remoteDescriptionSet) {
      debugLog('暂存ICE候选，等待远程描述设置');
      this.iceCandidateQueue.push(candidate);
      return;
    }
    
    try {
      debugLog('添加ICE候选');
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      debugLog('添加ICE候选失败', { error: error.message });
      // 部分错误可以忽略，因为有些候选可能不兼容
    }
  }
  
  // 处理队列中的ICE候选
  async _processIceCandidateQueue() {
    if (!this.remoteDescriptionSet || this.iceCandidateQueue.length === 0) return;
    
    debugLog(`处理 ${this.iceCandidateQueue.length} 个暂存的ICE候选`);
    
    for (const candidate of this.iceCandidateQueue) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        debugLog('添加暂存的ICE候选失败', { error: error.message });
      }
    }
    
    // 清空队列
    this.iceCandidateQueue = [];
  }
  
  // 尝试重新连接
  _attemptReconnect() {
    this.reconnectAttempts++;
    
    // 指数退避
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 20000);
    
    debugLog(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，延迟 ${delay}ms`);
    
    setTimeout(() => {
      if (this.peerConnection.connectionState === 'failed' || 
          this.peerConnection.connectionState === 'disconnected') {
        this._restartIce();
      }
    }, delay);
  }
  
  // 重启ICE
  async _restartIce() {
    if (!this.peerConnection || 
        this.peerConnection.connectionState === 'closed') {
      debugLog('无法重启ICE，连接已关闭');
      return;
    }
    
    try {
      debugLog('执行ICE重启');
      
      if (this.isInitiator) {
        const offerOptions = {
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
          iceRestart: true
        };
        
        const offer = await this.peerConnection.createOffer(offerOptions);
        await this.peerConnection.setLocalDescription(offer);
        
        // 发送新的offer给对方
        debugLog('发送ICE重启Offer');
        this.onSignal(this.peerConnection.localDescription);
      }
      
    } catch (error) {
      debugLog('ICE重启失败', { error: error.message });
      this.onError(error);
    }
  }
  
  // 通过指定通道发送数据
  sendData(data, channelName = 'chat') {
    if (!this.dataChannels[channelName]) {
      debugLog(`无法发送数据，通道 ${channelName} 不存在`);
      return false;
    }
    
    if (this.dataChannels[channelName].readyState !== 'open') {
      debugLog(`无法发送数据，通道 ${channelName} 未打开`, { 
        state: this.dataChannels[channelName].readyState 
      });
      return false;
    }
    
    try {
      this.dataChannels[channelName].send(data);
      return true;
    } catch (error) {
      debugLog(`发送数据失败，通道 ${channelName}`, { error: error.message });
      this.onError(error);
      return false;
    }
  }
  
  // 获取通道状态
  getChannelState(channelName) {
    if (!this.dataChannels[channelName]) return null;
    return this.dataChannels[channelName].readyState;
  }
  
  // 获取连接状态
  getConnectionState() {
    if (!this.peerConnection) return 'closed';
    return this.peerConnection.connectionState || this.connectionState;
  }
  
  // 获取ICE连接状态
  getIceConnectionState() {
    if (!this.peerConnection) return 'closed';
    return this.peerConnection.iceConnectionState;
  }
  
  // 手动开始/触发连接
  async connect() {
    if (this.isInitiator && this.peerConnection) {
      await this._createOffer();
    }
  }
  
  // 手动执行ICE重启
  async restartIce() {
    await this._restartIce();
  }
  
  // 关闭连接
  close() {
    debugLog('关闭WebRTC连接');
    
    // 关闭所有数据通道
    Object.values(this.dataChannels).forEach(channel => {
      try {
        channel.close();
      } catch (error) {
        // 忽略错误
      }
    });
    
    this.dataChannels = {};
    
    // 关闭peer连接
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (error) {
        // 忽略错误
      }
      this.peerConnection = null;
    }
    
    this.connectionState = 'closed';
    this.onClose();
  }
}
