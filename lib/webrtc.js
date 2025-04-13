import { Peer } from "peerjs";

export class P2PConnection {
  constructor(
    roomId,
    peerId,
    onConnection,
    onData,
    onStream,
    onDisconnect,
    logEvent
  ) {
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
    this.pingInterval = null;
    this.latency = null; // 存储P2P延迟
    this.onLatencyChange = null; // 延迟变化回调
    this.currentFileChunk = undefined; // 存储当前接收的文件块元数据
    this.pendingChunkData = null; // 存储等待接收的文件块数据
  }

  async init() {
    // 如果已经在初始化过程中，返回同一个promise
    if (this._initPromise) {
      this.logEvent("WebRTC 连接正在初始化中，等待完成");
      return this._initPromise;
    }

    // 防止重复初始化
    if (this.initialized) {
      this.logEvent("WebRTC 连接已经初始化，跳过重复初始化");
      return this.peerId;
    }

    this.logEvent("正在初始化 WebRTC 连接...");

    // 创建初始化Promise并保存
    this._initPromise = (async () => {
      try {
        // 默认的STUN服务器列表
        let iceServers = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" },
        ];

        // 尝试获取地理位置最近的STUN服务器
        try {
          this.logEvent("正在查找最佳STUN服务器...");

          const GEO_LOC_URL =
            "https://bridge.ravelloh.top/raw.githubusercontent.com/pradt2/always-online-stun/master/geoip_cache.txt";
          const IPV4_URL =
            "https://bridge.ravelloh.top/raw.githubusercontent.com/pradt2/always-online-stun/master/valid_ipv4s.txt";
          const GEO_USER_URL = "https://geolocation-db.com/json/";

          // 并行发起所有请求
          const [geoLocs, ipv4List, geoUser] = await Promise.all([
            fetch(GEO_LOC_URL).then((res) => res.json()),
            fetch(IPV4_URL).then((res) => res.text()),
            fetch(GEO_USER_URL).then((res) => res.json()),
          ]);

          const { latitude, longitude } = geoUser;

          // 计算最近的STUN服务器
          const closestAddr = ipv4List
            .trim()
            .split("\n")
            .map((addr) => {
              const [stunLat, stunLon] = geoLocs[addr.split(":")[0]];
              const dist =
                ((latitude - stunLat) ** 2 + (longitude - stunLon) ** 2) ** 0.5;
              return [addr, dist];
            })
            .reduce(([addrA, distA], [addrB, distB]) =>
              distA <= distB ? [addrA, distA] : [addrB, distB]
            )[0];

          // 将找到的最近STUN服务器添加到列表头部
          if (closestAddr) {
            this.logEvent(`找到最近的STUN服务器: ${closestAddr}`);
            iceServers.unshift({ urls: `stun:${closestAddr}` });
          }
        } catch (error) {
          this.logEvent(
            `查找最佳STUN服务器失败: ${error.message}, 使用默认服务器`
          );
          console.error("Error finding optimal STUN server:", error);
        }

        this.peer = new Peer(this.peerId, {
          debug: 2,
          config: {
            iceServers: iceServers,
          },
        });

        this.logEvent("PeerJS 实例已创建，等待连接...");

        return new Promise((resolve, reject) => {
          this.peer.on("open", (id) => {
            this.logEvent(`Peer ID 已生成: ${id}`);
            this.initialized = true; // 标记为已初始化
            resolve(id);
          });

          this.peer.on("error", (err) => {
            this.logEvent(`Peer 错误: ${err.type} - ${err.message}`);
            this._initPromise = null; // 出错时清除Promise
            reject(err);
          });

          this.peer.on("connection", (conn) => {
            this.handleConnection(conn);
          });

          this.peer.on("call", (call) => {
            this.logEvent(
              `接收到媒体流呼叫, 类型: ${call.metadata?.type || "未知"}`
            );
            call.answer(); // 回答呼叫但不发送流

            call.on("stream", (stream) => {
              this.logEvent(
                `接收到远程媒体流, 类型: ${call.metadata?.type || "未知"}`
              );

              // 调用注册的回调
              if (this.mediaCallbacks.onStream) {
                this.mediaCallbacks.onStream(stream, call.metadata?.type);
              }

              if (this.onStream) this.onStream(stream);
            });

            call.on("close", () => {
              this.logEvent(
                `媒体流连接已关闭, 类型: ${call.metadata?.type || "未知"}`
              );
            });

            call.on("error", (err) => {
              this.logEvent(`媒体流错误: ${err.message}`, "error");
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
    if (
      !remotePeerId ||
      remotePeerId === this.peerId ||
      remotePeerId.includes(this.peerId) ||
      this.peerId.includes(remotePeerId)
    ) {
      this.logEvent(
        `检测到尝试连接到自己或无效的远程ID (${remotePeerId}), 连接已取消`
      );
      return Promise.reject(
        new Error("Cannot connect to yourself or invalid peer ID")
      );
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
    if (
      this.connection &&
      !this.connection.open &&
      this.connection.peer === remotePeerId
    ) {
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
          reject(new Error("Connection timeout"));
        }, 10000);

        // 检查连接状态的函数
        const checkConnection = () => {
          if (!this.connection) {
            clearTimeout(timeout);
            this._connectionLoggedForPeer = null;
            reject(new Error("Connection lost during establishment"));
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

    // 使用json序列化方式，确保控制消息能正确发送
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      serialization: "json", // 使用json序列化，而不是binary
    });

    this.handleConnection(conn);

    return new Promise((resolve, reject) => {
      // 设置连接超时 - 15秒
      const timeout = setTimeout(() => {
        this.logEvent(`创建连接到 ${remotePeerId} 超时，放弃连接`);
        reject(new Error("Connection timeout"));
      }, 15000);

      conn.on("open", () => {
        clearTimeout(timeout);
        this.logEvent("已成功连接到对方");
        resolve(conn);
      });

      conn.on("error", (err) => {
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

    conn.on("open", () => {
      this.logEvent(`连接打开: ${conn.peer}`);
      this.connectionOpen = true; // 设置连接状态为已打开

      // 立即开始测量延迟
      setTimeout(() => {
        this.startLatencyMeasurement((latency) => {
          this.latency = latency;
          // 不需要做任何事情，回调会在startLatencyMeasurement内部处理
        });
      }, 1000);

      if (this.onConnection) this.onConnection(conn);
    });

    conn.on("data", (data) => {
      this.handleData(data);
    });

    conn.on("close", () => {
      this.logEvent("连接已关闭");
      this.connectionOpen = false; // 重置连接状态
      if (this.onDisconnect) this.onDisconnect();
    });

    conn.on("error", (err) => {
      this.logEvent(`连接错误: ${err.message}`);
      // 注意：错误不一定意味着连接关闭，所以不重置 connectionOpen
    });
  }

  // 修复的数据处理逻辑
  handleData(data) {
    // 处理对象类型的数据（json序列化模式）
    if (typeof data === "object" && data !== null) {
      // 处理文件块数据 - 新的处理方式，单一消息包含元数据和数据
      if (
        data.type === "file-chunk" &&
        data.fileId &&
        data.chunkIndex !== undefined
      ) {
        const { fileId, chunkIndex, size, data: chunkData } = data;

        if (!this.fileChunks[fileId]) {
          this.logEvent(`接收到文件块但无相关文件信息: ${fileId}`, "error");
          return;
        }

        try {
          // 处理数据 - 从Array或base64字符串转换回Uint8Array
          let processedData;

          if (Array.isArray(chunkData)) {
            // 如果是数组，直接转换为Uint8Array
            processedData = new Uint8Array(chunkData);
          } else if (typeof chunkData === "string") {
            // 如果是base64字符串，解码为Uint8Array
            try {
              const binaryString = atob(chunkData);
              processedData = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                processedData[i] = binaryString.charCodeAt(i);
              }
            } catch (e) {
              this.logEvent(`Base64解码失败: ${e.message}`, "error");
              return;
            }
          } else {
            this.logEvent(
              `无法处理的文件块数据类型: ${typeof chunkData}`,
              "error"
            );
            return;
          }

          // 存储文件块
          this.fileChunks[fileId][chunkIndex] = processedData;
          this.fileMetadata[fileId].receivedChunks++;

          // 记录日志
          if (chunkIndex === 0 || chunkIndex % 50 === 0) {
            this.logEvent(
              `接收到文件块 #${chunkIndex}, 大小: ${processedData.byteLength} 字节`
            );
          }

          // 计算和更新进度
          const progress =
            (this.fileMetadata[fileId].receivedChunks /
              this.fileMetadata[fileId].totalChunks) *
            100;

          // 分发进度事件
          if (this.onData)
            this.onData({
              type: "file-progress",
              fileId: fileId,
              fileName: this.fileMetadata[fileId].name,
              progress: progress,
            });

          // 全局事件
          this.dispatchProgressEvent(
            fileId,
            this.fileMetadata[fileId].name,
            progress
          );

          // 检查是否已接收所有块
          if (
            this.fileMetadata[fileId].receivedChunks ===
            this.fileMetadata[fileId].totalChunks
          ) {
            this.reconstructFile(fileId);
          }
        } catch (error) {
          this.logEvent(`处理文件块数据失败: ${error.message}`, "error");
          console.error("File chunk processing error:", error);
        }

        return; // 处理完文件块后返回
      }

      // 处理其他消息类型
      if (data.type) {
        switch (data.type) {
          case "message":
            if (this.onData)
              this.onData({
                type: "message",
                content: data.content,
                sender: data.sender,
              });
            break;

          case "file-start":
            this.fileMetadata[data.fileId] = {
              name: data.fileName,
              size: data.fileSize,
              type: data.fileType,
              totalChunks: data.totalChunks,
              receivedChunks: 0,
            };
            this.fileChunks[data.fileId] = [];

            this.logEvent(
              `文件传输开始: ${data.fileName} (${Math.round(
                data.fileSize / 1024
              )} KB)`
            );

            if (this.onData)
              this.onData({
                type: "file-start",
                fileId: data.fileId,
                fileName: data.fileName,
                fileSize: data.fileSize,
                fileType: data.fileType,
              });
            break;

          case "file-complete":
            this.logEvent(`文件传输信息收到: ${data.fileName}`);
            // 如果文件数据还没完全接收，检查是否可以强制完成
            const fileId = Object.keys(this.fileMetadata).find(
              (id) => this.fileMetadata[id].name === data.fileName
            );

            if (
              fileId &&
              this.fileMetadata[fileId].receivedChunks <
                this.fileMetadata[fileId].totalChunks
            ) {
              this.logEvent(
                `文件未完全接收，已接收${this.fileMetadata[fileId].receivedChunks}/${this.fileMetadata[fileId].totalChunks}块`,
                "warn"
              );

              // 如果接收了超过95%的块，尝试重建
              if (
                this.fileMetadata[fileId].receivedChunks >=
                this.fileMetadata[fileId].totalChunks * 0.95
              ) {
                this.logEvent(
                  `尝试重建部分接收的文件: ${data.fileName}`,
                  "warn"
                );
                this.reconstructFile(fileId);
              }
            }
            break;

          case "ping":
            // 收到ping请求，立即回复pong
            if (this.connection && this.connection.open) {
              try {
                this.connection.send({
                  type: "pong",
                  id: data.id,
                  timestamp: Date.now(),
                });
              } catch (error) {
                console.error("Error sending pong response:", error);
              }
            }
            break;

          case "pong":
            // 收到pong响应，计算延迟
            try {
              const roundTripTime = Date.now() - data.id;
              this.latency = Math.floor(roundTripTime / 2); // 单向延迟(ms)

              // 仅在首次或延迟变化较大时记录日志
              if (
                !this._lastLoggedLatency ||
                Math.abs(this._lastLoggedLatency - this.latency) > 20
              ) {
                this.logEvent(`测量到P2P连接延迟: ${this.latency}ms`, "info");
                this._lastLoggedLatency = this.latency;
              }

              // 通知外部延迟已更新
              if (this.onLatencyChange) {
                this.onLatencyChange(this.latency);
              }
            } catch (error) {
              console.error("Error calculating latency:", error);
            }
            break;

          default:
            if (this.onData) this.onData(data);
            break;
        }
      }
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      // 直接处理二进制数据 - 由于我们现在在单一消息中包含所有内容，这段代码可能不再需要
      this.logEvent(
        `接收到二进制数据，但新的传输逻辑不需要处理此类数据。数据大小: ${
          data.byteLength || "unknown"
        } 字节`,
        "warn"
      );
    } else {
      this.logEvent(`接收到未知类型的数据: ${typeof data}`, "warn");
    }
  }

  // 新增方法，处理二进制数据
  handleBinaryData(buffer, metadata) {
    const { fileId, chunkIndex } = metadata;

    if (this.fileChunks[fileId]) {
      try {
        // 确保buffer是有效的二进制数据
        let chunk;
        if (buffer instanceof ArrayBuffer) {
          chunk = new Uint8Array(buffer);
        } else if (ArrayBuffer.isView(buffer)) {
          chunk = new Uint8Array(buffer.buffer);
        } else {
          chunk = new Uint8Array(buffer);
        }

        this.fileChunks[fileId][chunkIndex] = chunk;
        this.fileMetadata[fileId].receivedChunks++;

        const progress =
          (this.fileMetadata[fileId].receivedChunks /
            this.fileMetadata[fileId].totalChunks) *
          100;

        if (this.onData)
          this.onData({
            type: "file-progress",
            fileId: fileId,
            fileName: this.fileMetadata[fileId].name,
            progress: progress,
          });

        if (
          this.fileMetadata[fileId].receivedChunks ===
          this.fileMetadata[fileId].totalChunks
        ) {
          this.reconstructFile(fileId);
        }
      } catch (error) {
        this.logEvent(`处理二进制数据失败: ${error.message}`, "error");
      }
    }
  }

  reconstructFile(fileId) {
    const metadata = this.fileMetadata[fileId];
    const chunks = this.fileChunks[fileId];

    if (!metadata || !chunks) {
      this.logEvent(`无法重建文件: 缺少元数据或数据块`, "error");
      return;
    }

    this.logEvent(
      `重建文件: ${metadata.name}, 数据块数量: ${chunks.length}, 总块数: ${metadata.totalChunks}`
    );

    try {
      // 计算总长度和验证chunks
      let totalLength = 0;
      let validChunks = 0;
      let missingChunks = [];

      // 先检查所有块并计算总大小
      for (let i = 0; i < metadata.totalChunks; i++) {
        const chunk = chunks[i];
        if (chunk && chunk.byteLength) {
          validChunks++;
          totalLength += chunk.byteLength;

          if (i === 0 || i === chunks.length - 1 || i % 100 === 0) {
            this.logEvent(
              `块 ${i}: 类型=${chunk.constructor.name}, 大小=${chunk.byteLength} 字节`
            );
          }
        } else {
          missingChunks.push(i);
        }
      }

      this.logEvent(
        `有效块数: ${validChunks}/${metadata.totalChunks}, 计算总大小: ${totalLength} 字节`
      );

      if (missingChunks.length > 0) {
        this.logEvent(
          `警告: 缺少 ${missingChunks.length} 个数据块，尝试继续重建`,
          "warn"
        );
      }

      if (totalLength === 0) {
        this.logEvent(`错误: 文件大小为0，无法重建`, "error");
        this.logEvent(
          `调试信息: 文件元数据=${JSON.stringify(metadata)}`,
          "debug"
        );
        return;
      }

      // 创建一个足够大的缓冲区
      const fileData = new Uint8Array(totalLength);

      // 复制所有块
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk && chunk.byteLength) {
          try {
            fileData.set(chunk, offset);
            offset += chunk.byteLength;
          } catch (error) {
            this.logEvent(
              `设置数据块时出错: ${error.message}, 块=${i}, 偏移=${offset}`,
              "error"
            );
          }
        }
      }

      // 创建Blob前进行最终检查
      if (offset === 0) {
        this.logEvent(`错误: 最终文件偏移量为0，无法创建有效文件`, "error");
        return;
      }

      // 创建Blob
      const blob = new Blob([fileData.buffer], {
        type: metadata.type || "application/octet-stream",
      });

      this.logEvent(`文件重建完成: ${metadata.name}, 大小: ${blob.size} 字节`);

      if (this.onData)
        this.onData({
          type: "file-complete",
          fileId: fileId,
          fileName: metadata.name,
          fileSize: blob.size,
          fileType: metadata.type || "application/octet-stream",
          fileData: blob,
        });

      // 清理内存
      delete this.fileChunks[fileId];
      delete this.fileMetadata[fileId];
    } catch (error) {
      this.logEvent(`文件重建失败: ${error.message}`, "error");
      console.error("File reconstruction error:", error);
    }
  }

  sendMessage(content) {
    if (!this.connection) {
      this.logEvent("无法发送消息: 连接不存在");
      return false;
    }

    try {
      this.connection.send({
        type: "message",
        content: content,
        sender: this.peerId,
        timestamp: Date.now(),
      });
      return true;
    } catch (error) {
      this.logEvent(`发送消息失败: ${error.message}`, "error");
      return false;
    }
  }

  async sendFile(file) {
    if (!this.connection) {
      this.logEvent("无法发送文件: 连接不存在");
      return false;
    }

    // 使用更安全的唯一ID生成方式，避免时间戳冲突
    const fileId = `file_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // 先检查文件是否合法
    if (!file || file.size === 0) {
      this.logEvent(`文件发送错误: 文件为空或无效`, "error");
      return Promise.reject(new Error("Invalid file"));
    }

    const fileReader = new FileReader();
    const chunkSize = 16 * 1024; // 16KB 块大小
    const totalChunks = Math.ceil(file.size / chunkSize);

    this.logEvent(
      `准备发送文件: ${file.name} (${Math.round(file.size / 1024)} KB)`
    );

    // 添加传输状态对象，用于跟踪传输进度
    this._fileTransfers = this._fileTransfers || {};
    this._fileTransfers[fileId] = {
      name: file.name,
      size: file.size,
      currentChunk: 0,
      totalChunks: totalChunks,
      startTime: Date.now(),
      aborted: false,
    };

    // 发送文件开始信息
    try {
      // 先记录开始发送的日志，确保顺序正确
      this.logEvent(
        `开始发送文件: ${file.name} (${Math.round(file.size / 1024)} KB)`
      );

      await new Promise((resolve) => setTimeout(resolve, 100)); // 短暂延迟让日志正确显示

      this.connection.send({
        type: "file-start",
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "application/octet-stream",
        totalChunks: totalChunks,
      });

      // 增加一个额外的延迟，确保文件开始元数据被接收方处理
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      this.logEvent(`发送文件元数据失败: ${error.message}`, "error");
      delete this._fileTransfers[fileId];
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let chunkIndex = 0;
      let retries = 0;
      const maxRetries = 3;

      const readNextChunk = () => {
        // 检查传输是否已终止
        if (this._fileTransfers[fileId]?.aborted) {
          this.logEvent(`文件传输已终止: ${file.name}`, "warn");
          delete this._fileTransfers[fileId];
          reject(new Error("File transfer aborted"));
          return;
        }

        const start = chunkSize * chunkIndex;
        const end = Math.min(file.size, start + chunkSize);
        try {
          fileReader.readAsArrayBuffer(file.slice(start, end));
        } catch (error) {
          this.logEvent(`读取文件块失败: ${error.message}`, "error");
          delete this._fileTransfers[fileId];
          reject(error);
        }
      };

      const sendChunk = (arrayBuffer) => {
        try {
          // 检查连接状态
          if (!this.connection || !this.connection.open) {
            this.logEvent(`发送文件块失败: 连接已关闭`, "error");
            delete this._fileTransfers[fileId];
            reject(new Error("Connection closed during file transfer"));
            return;
          }

          // 关键修复1: 直接发送元数据和数据在同一个消息内
          // 避免使用两个分离的消息, 这样可以防止数据错配和空对象问题
          this.connection.send({
            type: "file-chunk",
            fileId: fileId,
            chunkIndex: chunkIndex,
            size: arrayBuffer.byteLength,
            // 关键修复2: 将ArrayBuffer转换为Array以便JSON序列化
            // 或者使用base64编码，选择其中一种
            // 方法1: Array转换 (可能较大)
            data: Array.from(new Uint8Array(arrayBuffer)),
            // 方法2: Base64编码 (根据情况选择)
            // data: btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuffer)))
          });

          // 调试日志，帮助追踪文件块传输
          if (chunkIndex === 0 || chunkIndex % 50 === 0) {
            this.logEvent(
              `已发送文件块 #${chunkIndex}/${totalChunks}, 大小: ${arrayBuffer.byteLength} 字节`
            );
          }

          // 更新进度
          this._fileTransfers[fileId].currentChunk = chunkIndex + 1;
          const progress = Math.min(
            ((chunkIndex + 1) / totalChunks) * 100,
            100
          );

          // 分发进度事件
          if (this.onData)
            this.onData({
              type: "file-progress",
              fileId: fileId,
              fileName: file.name,
              progress: progress,
            });

          // 关键修复：主动触发全局事件，确保UI组件能接收到进度更新
          this.dispatchProgressEvent(fileId, file.name, progress);

          retries = 0; // 重置重试计数
          chunkIndex++;

          if (chunkIndex < totalChunks) {
            // 添加短暂延迟，避免数据通道拥堵
            setTimeout(readNextChunk, 5); // 减小延迟时间，加快传输
          } else {
            // 所有块已发送
            setTimeout(() => {
              // 再次检查连接状态
              if (!this.connection || !this.connection.open) {
                delete this._fileTransfers[fileId];
                reject(new Error("Connection closed during file transfer"));
                return;
              }

              try {
                // 发送完成事件
                this.connection.send({
                  type: "file-complete",
                  fileId: fileId,
                  fileName: file.name,
                  fileSize: file.size,
                  fileType: file.type || "application/octet-stream",
                });

                // 计算传输统计信息
                const endTime = Date.now();
                const transferTime =
                  (endTime - this._fileTransfers[fileId].startTime) / 1000;
                const speedMBps = file.size / (1024 * 1024) / transferTime;

                // 记录日志，但要确保日志消息唯一，避免重复
                this.logEvent(
                  `文件发送完成: ${file.name} (速度: ${speedMBps.toFixed(
                    2
                  )} MB/s)`
                );

                // 清理并返回结果
                delete this._fileTransfers[fileId];
                resolve({
                  fileId: fileId,
                  fileName: file.name,
                  fileSize: file.size,
                  fileType: file.type || "application/octet-stream",
                  transferTime: transferTime,
                  speed: speedMBps,
                });
              } catch (error) {
                this.logEvent(
                  `发送文件完成事件失败: ${error.message}`,
                  "error"
                );
                delete this._fileTransfers[fileId];
                reject(error);
              }
            }, 300); // 增加延迟以确保所有块都已处理
          }
        } catch (error) {
          this.logEvent(`发送文件块数据失败: ${error.message}`, "error");
          reject(error);
        }
      };

      fileReader.onload = (e) => {
        sendChunk(e.target.result);
      };

      fileReader.onerror = (e) => {
        this.logEvent(
          `文件读取错误: ${file.name} - ${e.target.error}`,
          "error"
        );
        delete this._fileTransfers[fileId];
        reject(new Error("File reading error"));
      };

      // 开始读取第一块
      readNextChunk();
    });
  }

  // 新增方法：分发进度事件
  dispatchProgressEvent(fileId, fileName, progress) {
    try {
      const event = new CustomEvent("file-progress", {
        detail: {
          fileId: fileId,
          fileName: fileName,
          progress: progress,
        },
      });
      window.dispatchEvent(event);

      // 每25%记录一次进度
      if (Math.floor(progress) % 25 === 0 || progress >= 99.9) {
        this.logEvent(`文件 ${fileName} 传输进度: ${Math.floor(progress)}%`);
      }
    } catch (error) {
      console.error("分发进度事件失败:", error);
    }
  }

  // 新增：取消文件传输方法
  cancelFileTransfer(fileId) {
    if (this._fileTransfers && this._fileTransfers[fileId]) {
      this._fileTransfers[fileId].aborted = true;
      this.logEvent(
        `文件传输已取消: ${this._fileTransfers[fileId].name}`,
        "warn"
      );
      return true;
    }
    return false;
  }

  shareScreen() {
    this.logEvent("尝试共享屏幕...");
    return navigator.mediaDevices
      .getDisplayMedia({ video: true })
      .then((stream) => {
        this.logEvent("屏幕共享获取成功，正在发送...");
        if (this.connection && this.peer) {
          const call = this.peer.call(this.connection.peer, stream);
          return stream;
        } else {
          throw new Error("没有可用的连接");
        }
      })
      .catch((err) => {
        this.logEvent(`屏幕共享失败: ${err.message}`);
        throw err;
      });
  }

  close() {
    this.stopLatencyMeasurement();

    if (this.connection) {
      this.connection.close();
    }
    if (this.peer) {
      this.peer.destroy();
    }
    this.logEvent("WebRTC连接已关闭");
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
        metadata: { type },
      });

      // 存储call对象以供将来引用
      if (!this.mediaCalls) this.mediaCalls = {};
      this.mediaCalls[type] = call;

      return true;
    } catch (error) {
      this.logEvent(`发送${type}流失败: ${error.message}`, "error");
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
      this.logEvent(`停止${type}流失败: ${error.message}`, "error");
    }
  }

  // 注册媒体流回调
  onMediaStream(callback) {
    this.mediaCallbacks.onStream = callback;
  }

  // 添加一个公共方法来检查连接状态
  isConnected() {
    const isConnected = Boolean(
      this.connection && this.connection.open && this.connectionOpen
    );

    // 如果连接状态发生变化，记录一次日志
    if (isConnected !== this._lastConnectionState) {
      if (isConnected) {
        this.logEvent("连接已激活，通信准备就绪");
      }
      this._lastConnectionState = isConnected;
    }

    return isConnected;
  }

  // 开始测量P2P延迟
  startLatencyMeasurement(callback) {
    this.onLatencyChange = callback;

    // 清除任何现有的定时器
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // 记录开始测量
    this.logEvent("开始P2P连接延迟测量");

    // 每5秒发送一次ping
    this.pingInterval = setInterval(() => {
      if (this.connection && this.connection.open) {
        const pingId = Date.now(); // 使用时间戳作为ping的ID
        try {
          this.connection.send({
            type: "ping",
            id: pingId,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error("Error sending ping:", error);
        }
      }
    }, 5000);

    // 立即发送第一个ping
    if (this.connection && this.connection.open) {
      try {
        const pingId = Date.now();
        this.connection.send({
          type: "ping",
          id: pingId,
          timestamp: Date.now(),
        });
        this.logEvent("已发送首次延迟测量请求", "info");
      } catch (error) {
        console.error("Error sending initial ping:", error);
        this.logEvent(`发送初始ping失败: ${error.message}`, "error");
      }
    } else {
      this.logEvent("无法发送ping：连接未就绪", "warn");
    }
  }

  // 停止测量延迟
  stopLatencyMeasurement() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.onLatencyChange = null;
  }

  // 获取当前延迟
  getLatency() {
    return this.latency;
  }
}

export default P2PConnection;
