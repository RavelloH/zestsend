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
          this.logEvent('接收到媒体流呼叫');
          call.answer();
          call.on('stream', stream => {
            this.logEvent('接收到远程媒体流');
            if (this.onStream) this.onStream(stream);
          });
        });
      });
    } catch (err) {
      this.logEvent(`初始化 WebRTC 连接失败: ${err.message}`);
      throw err;
    }
  }

  connect(remotePeerId) {
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
}

export default P2PConnection;
