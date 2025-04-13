import { Peer } from 'peerjs';

export class P2PConnection {
  constructor(roomId, peerId, onConnection, onData, onStream, onDisconnect, logEvent) {
    this.roomId = roomId;
    this.peerId = peerId;
    this.onConnection = onConnection;
    this.onData = onData;
    this.onStream = onStream;
    this.onDisconnect = onDisconnect;
    this.logEvent = logEvent || console.log;
    this.peer = null;
    this.connection = null;
    this.fileChunks = {};
    this.fileMetadata = {};
    this.mediaCallbacks = {}; // 存储媒体流回调
    this.initialized = false; // 添加初始化标志
    this._initPromise = null; // 存储初始化Promise
  }

  async init() {
    // 如果已经在初始化过程中，返回同一个promise
    if (this._initPromise) {
      this.logEvent('WebRTC 连接正在初始化中，等待完成');
      return this._initPromise;
    }

    // 防止重复初始化
    if (this.initialized) {
      this.logEvent('WebRTC 连接已经初始化，跳过重复初始化');
      return this.peerId;
    }
    
    this.logEvent('正在初始化 WebRTC 连接...');
    
    // 创建初始化Promise并保存
    this._initPromise = (async () => {
      try {
        this.peer = new Peer(this.peerId, {
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' },
            ]
          }
        });

        this.logEvent('PeerJS 实例已创建，等待连接...');

        return new Promise((resolve, reject) => {
          this.peer.on('open', id => {
            this.logEvent(`Peer ID 已生成: ${id}`);
            this.initialized = true; // 标记为已初始化
            resolve(id);
          });

          this.peer.on('error', err => {
            this.logEvent(`Peer 错误: ${err.type} - ${err.message}`);
            this._initPromise = null; // 出错时清除Promise
            reject(err);
          });

          this.peer.on('connection', conn => {
            this.handleConnection(conn);
          });

          this.peer.on('call', call => {
            this.logEvent(`接收到媒体流呼叫, 类型: ${call.metadata?.type || '未知'}`);
            call.answer(); // 回答呼叫但不发送流
            
            call.on('stream', stream => {
              this.logEvent(`接收到远程媒体流, 类型: ${call.metadata?.type || '未知'}`);
              
              // 调用注册的回调
              if (this.mediaCallbacks.onStream) {
                this.mediaCallbacks.onStream(stream, call.metadata?.type);
              }
              
              if (this.onStream) this.onStream(stream);
            });
            
            call.on('close', () => {
              this.logEvent(`媒体流连接已关闭, 类型: ${call.metadata?.type || '未知'}`);
            });
            
            call.on('error', err => {
              this.logEvent(`媒体流错误: ${err.message}`, 'error');
            });
          });
        });
      } catch (err) {
        this.logEvent(`初始化 WebRTC 连接失败: ${err.message}`);
        this._initPromise = null; // 出错时清除Promise
        throw err;
      }
    })();
    
    return this._initPromise;
  }

  connect(remotePeerId) {
    // 更严格地检查是否连接到自己
    if (!remotePeerId || remotePeerId === this.peerId || remotePeerId.includes(this.peerId) || this.peerId.includes(remotePeerId)) {
      this.logEvent(`检测到尝试连接到自己或无效的远程ID (${remotePeerId}), 连接已取消`);
      return Promise.reject(new Error('Cannot connect to yourself or invalid peer ID'));
    }
    
    // 更严格地检查连接状态
    if (this.isConnected() && this.connection.peer === remotePeerId) {
      this.logEvent(`已经连接到: ${this.connection.peer}, 无需重复连接`);
      return Promise.resolve(this.connection);
    }
    
    // 如果已经有连接且已打开，直接返回该连接
    if (this.connection && this.connection.open) {
      this.logEvent(`已经连接到: ${this.connection.peer}, 无需重复连接`);
      return Promise.resolve(this.connection);
    }
    
    // 如果有连接对象但状态为关闭，清除它以便创建新连接
    if (this.connection && !this.connection.open && this.connection.peer === remotePeerId) {
      this.logEvent(`检测到与 ${remotePeerId} 的连接已关闭，将创建新连接`);
      this.connection = null;
      this._connectionLoggedForPeer = null;
    }
    
    // 如果正在建立连接
    if (this.connection && this.connection.peer === remotePeerId) {
      // 不要重复记录日志，避免日志刷屏
      if (!this._connectionLoggedForPeer) {
        this.logEvent(`已经在连接到: ${remotePeerId}, 等待连接完成`);
        this._connectionLoggedForPeer = remotePeerId;
      }
      
      return new Promise((resolve, reject) => {
        // 设置连接超时 - 10秒
        const timeout = setTimeout(() => {
          this.logEvent(`连接到 ${remotePeerId} 超时，放弃连接`);
          this._connectionLoggedForPeer = null;
          reject(new Error('Connection timeout'));
        }, 10000);
        
        // 检查连接状态的函数
        const checkConnection = () => {
          if (!this.connection) {
            clearTimeout(timeout);
            this._connectionLoggedForPeer = null;
            reject(new Error('Connection lost during establishment'));
            return;
          }
          
          if (this.connection.open) {
            clearTimeout(timeout);
            this._connectionLoggedForPeer = null;
            resolve(this.connection);
          } else {
            setTimeout(checkConnection, 500);
          }
        };
        
        checkConnection();
      });
    }
    
    // 清除之前的连接日志标记
    this._connectionLoggedForPeer = null;
    
    // 如果上述条件都不满足，创建新连接
    this.logEvent(`正在连接到对方: ${remotePeerId}`);
    
    // 关闭任何现有连接以避免并发连接问题
    if (this.connection) {
      this.logEvent(`关闭现有连接以创建新连接`);
      this.connection.close();
    }
    
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      serialization: 'json'
    });
    
    this.handleConnection(conn);
    
    return new Promise((resolve, reject) => {
      // 设置连接超时 - 15秒
      const timeout = setTimeout(() => {
        this.logEvent(`创建连接到 ${remotePeerId} 超时，放弃连接`);
        reject(new Error('Connection timeout'));
      }, 15000);
      
      conn.on('open', () => {
        clearTimeout(timeout);
        this.logEvent('已成功连接到对方');
        resolve(conn);
      });
      
      conn.on('error', err => {
        clearTimeout(timeout);
        this.logEvent(`连接错误: ${err.message}`);
        reject(err);
      });
    });
  }

  handleConnection(conn) {
    this.connection = conn;
    this.logEvent(`建立了新连接: ${conn.peer}`);
    
    // 添加一个标志来跟踪连接状态
    this.connectionOpen = false;

    conn.on('open', () => {
      this.logEvent(`连接打开: ${conn.peer}`);
      this.connectionOpen = true; // 设置连接状态为已打开
      if (this.onConnection) this.onConnection(conn);
    });

    conn.on('data', data => {
      this.handleData(data);
    });

    conn.on('close', () => {
      this.logEvent('连接已关闭');
      this.connectionOpen = false; // 重置连接状态
      if (this.onDisconnect) this.onDisconnect();
    });

    conn.on('error', err => {
      this.logEvent(`连接错误: ${err.message}`);
      // 注意：错误不一定意味着连接关闭，所以不重置 connectionOpen
    });
  }

  handleData(data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'message':
        if (this.onData) this.onData({
          type: 'message',
          content: data.content,
          sender: data.sender
        });
        break;

      case 'file-start':
        this.fileChunks[data.fileId] = [];
        this.fileMetadata[data.fileId] = {
          name: data.fileName,
          size: data.fileSize,
          type: data.fileType,
          totalChunks: data.totalChunks,
          receivedChunks: 0
        };
        this.logEvent(`文件传输开始: ${data.fileName} (${Math.round(data.fileSize / 1024)} KB)`);
        if (this.onData) this.onData({
          type: 'file-start',
          fileId: data.fileId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType
        });
        break;

      case 'file-chunk':
        if (this.fileChunks[data.fileId]) {
          this.fileChunks[data.fileId][data.chunkIndex] = data.chunk;
          this.fileMetadata[data.fileId].receivedChunks++;
          
          const progress = (this.fileMetadata[data.fileId].receivedChunks / this.fileMetadata[data.fileId].totalChunks) * 100;
          
          if (this.onData) this.onData({
            type: 'file-progress',
            fileId: data.fileId,
            progress: progress
          });

          if (this.fileMetadata[data.fileId].receivedChunks === this.fileMetadata[data.fileId].totalChunks) {
            // 所有块已接收，重建文件
            this.reconstructFile(data.fileId);
          }
        }
        break;

      default:
        if (this.onData) this.onData(data);
        break;
    }
  }

  reconstructFile(fileId) {
    const metadata = this.fileMetadata[fileId];
    const chunks = this.fileChunks[fileId];
    
    if (!metadata || !chunks) return;

    this.logEvent(`重建文件: ${metadata.name}`);
    
    // 转换所有块为Uint8Array
    const dataChunks = chunks.map(chunk => {
      if (typeof chunk === 'string') {
        // 如果块是Base64字符串，转换为Uint8Array
        const binaryString = atob(chunk);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }
      return chunk;
    });

    // 计算总长度
    const totalLength = dataChunks.reduce((total, chunk) => total + chunk.length, 0);
    
    // 创建一个足够大的缓冲区
    const fileData = new Uint8Array(totalLength);
    
    // 复制所有块
    let offset = 0;
    for (const chunk of dataChunks) {
      fileData.set(chunk, offset);
      offset += chunk.length;
    }
    
    // 创建Blob
    const blob = new Blob([fileData], { type: metadata.type });
    
    if (this.onData) this.onData({
      type: 'file-complete',
      fileId: fileId,
      fileName: metadata.name,
      fileSize: metadata.size,
      fileType: metadata.type,
      fileData: blob
    });
    
    // 清理内存
    delete this.fileChunks[fileId];
    delete this.fileMetadata[fileId];
  }

  sendMessage(content) {
    if (!this.connection) {
      this.logEvent('无法发送消息: 连接不存在');
      return false;
    }
    
    this.connection.send({
      type: 'message',
      content: content,
      sender: this.peerId,
      timestamp: Date.now()
    });
    
    return true;
  }

  async sendFile(file) {
    if (!this.connection) {
      this.logEvent('无法发送文件: 连接不存在');
      return false;
    }
    
    const fileId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const fileReader = new FileReader();
    const chunkSize = 16 * 1024; // 16KB 块大小
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    this.logEvent(`开始发送文件: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    
    // 发送文件开始消息
    this.connection.send({
      type: 'file-start',
      fileId: fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks: totalChunks
    });
    
    return new Promise((resolve, reject) => {
      let chunkIndex = 0;
      
      const readNextChunk = () => {
        const start = chunkSize * chunkIndex;
        const end = Math.min(file.size, start + chunkSize);
        fileReader.readAsArrayBuffer(file.slice(start, end));
      };
      
      fileReader.onload = e => {
        const chunk = new Uint8Array(e.target.result);
        
        // 发送块
        this.connection.send({
          type: 'file-chunk',
          fileId: fileId,
          chunkIndex: chunkIndex,
          chunk: chunk
        });
        
        const progress = ((chunkIndex + 1) / totalChunks) * 100;
        
        if (this.onData) this.onData({
          type: 'file-progress',
          fileId: fileId,
          fileName: file.name,
          progress: progress
        });
        
        chunkIndex++;
        
        if (chunkIndex < totalChunks) {
          // 继续读取下一块
          readNextChunk();
        } else {
          // 所有块已发送
          this.logEvent(`文件发送完成: ${file.name}`);
          resolve({
            fileId: fileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
          });
        }
      };
      
      fileReader.onerror = () => {
        this.logEvent(`文件读取错误: ${file.name}`);
        reject(new Error('File reading error'));
      };
      
      // 开始读取第一块
      readNextChunk();
    });
  }

  shareScreen() {
    this.logEvent('尝试共享屏幕...');
    return navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(stream => {
        this.logEvent('屏幕共享获取成功，正在发送...');
        if (this.connection && this.peer) {
          const call = this.peer.call(this.connection.peer, stream);
          return stream;
        } else {
          throw new Error('没有可用的连接');
        }
      })
      .catch(err => {
        this.logEvent(`屏幕共享失败: ${err.message}`);
        throw err;
      });
  }

  close() {
    if (this.connection) {
      this.connection.close();
    }
    if (this.peer) {
      this.peer.destroy();
    }
    this.logEvent('WebRTC连接已关闭');
  }

  // 发送媒体流
  sendMediaStream(stream, type) {
    if (!this.peer || !this.connection || !stream) {
      this.logEvent(`无法发送${type}流: 连接不存在或流无效`);
      return false;
    }
    
    try {
      this.logEvent(`开始发送${type}流...`);
      
      // 使用PeerJS的call方法发送媒体流
      const call = this.peer.call(this.connection.peer, stream, {
        metadata: { type }
      });
      
      // 存储call对象以供将来引用
      if (!this.mediaCalls) this.mediaCalls = {};
      this.mediaCalls[type] = call;
      
      return true;
    } catch (error) {
      this.logEvent(`发送${type}流失败: ${error.message}`, 'error');
      return false;
    }
  }
  
  // 停止发送媒体流
  stopMediaStream(type) {
    if (!this.mediaCalls || !this.mediaCalls[type]) {
      return;
    }
    
    try {
      // 关闭对应的call
      this.mediaCalls[type].close();
      delete this.mediaCalls[type];
      this.logEvent(`已停止发送${type}流`);
    } catch (error) {
      this.logEvent(`停止${type}流失败: ${error.message}`, 'error');
    }
  }
  
  // 注册媒体流回调
  onMediaStream(callback) {
    this.mediaCallbacks.onStream = callback;
  }

  // 添加一个公共方法来检查连接状态
  isConnected() {
    // 更严格地检查连接对象是否存在且处于打开状态
    const isConnected = Boolean(this.connection && this.connection.open && this.connectionOpen);
    
    // 如果连接状态发生变化，记录一次日志
    if (isConnected !== this._lastConnectionState) {
      if (isConnected) {
        this.logEvent('连接已激活，通信准备就绪');
      }
      this._lastConnectionState = isConnected;
    }
    
    return isConnected;
  }
}

export default P2PConnection;
