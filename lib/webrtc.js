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
  }

  async init() {
    this.logEvent('正在初始化 WebRTC 连接...');
    
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
          resolve(id);
        });

        this.peer.on('error', err => {
          this.logEvent(`Peer 错误: ${err.type} - ${err.message}`);
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
      throw err;
    }
  }

  connect(remotePeerId) {
    // 更严格地检查是否连接到自己
    if (!remotePeerId || remotePeerId === this.peerId || remotePeerId.includes(this.peerId) || this.peerId.includes(remotePeerId)) {
      this.logEvent(`检测到尝试连接到自己或无效的远程ID (${remotePeerId}), 连接已取消`);
      return Promise.reject(new Error('Cannot connect to yourself or invalid peer ID'));
    }
    
    // 如果已经有连接或正在连接，则不要重复连接
    if (this.connection && this.connection.open) {
      this.logEvent(`已经连接到: ${this.connection.peer}, 无需重复连接`);
      return Promise.resolve(this.connection);
    }
    
    if (this.connection && this.connection.peer === remotePeerId) {
      this.logEvent(`已经尝试连接到: ${remotePeerId}, 等待连接完成`);
      return new Promise((resolve, reject) => {
        const checkConnection = () => {
          if (this.connection.open) {
            resolve(this.connection);
          } else {
            setTimeout(checkConnection, 500);
          }
        };
        checkConnection();
      });
    }
    
    this.logEvent(`正在连接到对方: ${remotePeerId}`);
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      serialization: 'json'
    });
    
    this.handleConnection(conn);
    
    return new Promise((resolve, reject) => {
      conn.on('open', () => {
        this.logEvent('已成功连接到对方');
        resolve(conn);
      });
      conn.on('error', err => {
        this.logEvent(`连接错误: ${err.message}`);
        reject(err);
      });
    });
  }

  handleConnection(conn) {
    this.connection = conn;
    this.logEvent(`建立了新连接: ${conn.peer}`);

    conn.on('open', () => {
      this.logEvent(`连接打开: ${conn.peer}`);
      if (this.onConnection) this.onConnection(conn);
    });

    conn.on('data', data => {
      this.handleData(data);
    });

    conn.on('close', () => {
      this.logEvent('连接已关闭');
      if (this.onDisconnect) this.onDisconnect();
    });

    conn.on('error', err => {
      this.logEvent(`连接错误: ${err.message}`);
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
          // 将Base64编码的块转换回ArrayBuffer
          const binaryChunk = base64ToArrayBuffer(data.chunk);
          this.fileChunks[data.fileId][data.chunkIndex] = binaryChunk;
          this.fileMetadata[data.fileId].receivedChunks++;
          
          const progress = (this.fileMetadata[data.fileId].receivedChunks / this.fileMetadata[data.fileId].totalChunks) * 100;
          
          if (this.onData) {
            this.onData({
              type: 'file-progress',
              fileId: data.fileId,
              progress: progress
            });
          }

          // 检查是否是最后一个块或已收到所有块
          if (data.final || this.fileMetadata[data.fileId].receivedChunks === this.fileMetadata[data.fileId].totalChunks) {
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
    if (!this.connection || !this.connection.open) {
      this.logEvent(`无法发送文件: 连接不存在或未打开`, 'error');
      return Promise.reject(new Error('无法发送文件: 连接不存在或未打开'));
    }
    
    const fileId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const fileReader = new FileReader();
    // 使用更小的块大小
    const chunkSize = 16 * 1024; // 16KB 块大小
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    this.logEvent(`开始发送文件: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    
    try {
      // 先发送文件元信息
      this.connection.send({
        type: 'file-start',
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        totalChunks: totalChunks
      });
      
      // 使用Promise包装文件读取和发送
      return new Promise((resolve, reject) => {
        let chunkIndex = 0;
        let lastProgressUpdate = 0;
        
        const readNextChunk = () => {
          const start = chunkSize * chunkIndex;
          const end = Math.min(file.size, start + chunkSize);
          fileReader.readAsArrayBuffer(file.slice(start, end));
        };
        
        fileReader.onload = e => {
          try {
            const chunk = e.target.result;
            const base64Chunk = arrayBufferToBase64(chunk);
            
            // 发送当前块
            this.connection.send({
              type: 'file-chunk',
              fileId: fileId,
              chunkIndex: chunkIndex,
              chunk: base64Chunk,
              final: chunkIndex === totalChunks - 1
            });
            
            chunkIndex++;
            
            // 控制进度更新频率，避免发送过多消息
            const now = Date.now();
            if (now - lastProgressUpdate > 500 || chunkIndex === totalChunks) {
              lastProgressUpdate = now;
              const progress = Math.round((chunkIndex / totalChunks) * 100);
              
              // 发送进度更新
              this.connection.send({
                type: 'file-progress',
                fileId: fileId,
                progress: progress
              });
            }
            
            if (chunkIndex < totalChunks) {
              // 使用setTimeout进行异步处理，避免阻塞UI
              setTimeout(readNextChunk, 0);
            } else {
              // 所有块已发送
              this.logEvent(`文件发送完成: ${file.name}`, 'success');
              resolve();
            }
          } catch (error) {
            this.logEvent(`发送文件块失败: ${error.message}`, 'error');
            reject(error);
          }
        };
        
        fileReader.onerror = (error) => {
          this.logEvent(`文件读取错误: ${error}`, 'error');
          reject(new Error('文件读取失败'));
        };
        
        // 开始读取第一块
        readNextChunk();
      });
    } catch (error) {
      this.logEvent(`文件传输初始化失败: ${error.message}`, 'error');
      throw error;
    }
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
}

// ArrayBuffer 转 Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64 转 ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export default P2PConnection;
