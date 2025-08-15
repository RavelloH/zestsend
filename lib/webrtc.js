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
    this.stunServerCallbacks = [];
    this.activeStunServer = null;

    // 新增：TURN服务器相关属性
    this.turnServerCallbacks = [];
    this.activeTurnServer = null;
    this.connectionAttempts = 0;
    this.maxDirectAttempts = 1; // 最多尝试1次直接连接
    this.usingTurnServer = false;
    this.turnTestResults = null;
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
        // 默认的STUN和TURN服务器列表
        let iceServers = [];

        // 尝试获取地理位置最近的STUN服务器
        try {
          this.logEvent("正在测试STUN服务器连接性能...");

          // 创建一组待测试的STUN服务器
          const stunServersToTest = [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302",
            "stun:stun.ekiga.net:3478",
            "stun:stun.ideasip.com:3478",
            "stun:stun.schlund.de:3478",
            "stun:stun.stunprotocol.org:3478",
            "stun:stun.voiparound.com:3478",
          ];

          // 获取 Cloudflare TURN 服务器凭据
          let turnServersToTest = [];
          try {
            this.logEvent("正在获取 Cloudflare TURN 服务器凭据...");
            const turnResponse = await fetch('/api/turn/credentials', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ttl: 86400 }), // 24小时有效期
            });

            if (turnResponse.ok) {
              const turnData = await turnResponse.json();
              if (turnData.iceServers && turnData.iceServers.length > 0) {
                // Cloudflare 返回的格式已经是正确的
                turnServersToTest = turnData.iceServers;
                this.logEvent(`获取到 Cloudflare TURN 凭据，包含 ${turnServersToTest.length} 个服务器`);
              }
            } else {
              this.logEvent("获取 Cloudflare TURN 凭据失败，使用备用服务器");
            }
          } catch (error) {
            this.logEvent(`获取 Cloudflare TURN 凭据出错: ${error.message}，使用备用服务器`);
          }

          // 如果 Cloudflare TURN 获取失败，使用备用 TURN 服务器
          if (turnServersToTest.length === 0) {
            turnServersToTest = [
              {
                urls: "turn:global.relay.metered.ca:80",
                username: "96a1ad6f89fa729e0a376363",
                credential: "9zzYK/mdphtwVcyZ",
              },
              {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject",
              }
            ];
            this.logEvent("使用备用 TURN 服务器进行连接");
          }

          // 使用Promise.race并发测试所有STUN服务器响应时间
          const stunTestResults = await Promise.all(
            stunServersToTest.map(async (stunUrl) => {
              const startTime = Date.now();
              try {
                // 创建RTCPeerConnection测试STUN服务器连接性
                const pc = new RTCPeerConnection({
                  iceServers: [{ urls: stunUrl }],
                });

                // 添加空数据通道以触发ICE收集
                pc.createDataChannel("stun-test");

                // 创建offer并设置本地描述
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // 等待ICE候选收集
                const icePromise = new Promise((resolve) => {
                  const timeout = setTimeout(() => {
                    resolve({ stunUrl, success: false, latency: Infinity });
                    pc.close();
                  }, 5000); // 5秒超时

                  pc.onicecandidate = (event) => {
                    // 当收到服务器反馈的ICE候选时，表示服务器可用
                    if (
                      event.candidate &&
                      event.candidate.candidate.includes("typ srflx")
                    ) {
                      clearTimeout(timeout);
                      const latency = Date.now() - startTime;
                      resolve({ stunUrl, success: true, latency });
                      pc.close();
                    }
                  };
                });

                return icePromise;
              } catch (error) {
                return { stunUrl, success: false, latency: Infinity };
              }
            })
          );

          // 新增：测试TURN服务器
          this.logEvent("正在测试TURN服务器连接性能...");
          const turnTestResults = await Promise.all(
            turnServersToTest.map(async (turnServer) => {
              const startTime = Date.now();
              try {
                // 创建RTCPeerConnection测试TURN服务器连接性
                const pc = new RTCPeerConnection({
                  iceServers: [turnServer],
                });

                // 添加空数据通道以触发ICE收集
                pc.createDataChannel("turn-test");

                // 创建offer并设置本地描述
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // 等待ICE候选收集
                const icePromise = new Promise((resolve) => {
                  const timeout = setTimeout(() => {
                    resolve({
                      turnUrl: Array.isArray(turnServer.urls) ? turnServer.urls[0] : turnServer.urls,
                      urls: turnServer.urls,
                      username: turnServer.username,
                      credential: turnServer.credential,
                      success: false,
                      latency: Infinity,
                    });
                    pc.close();
                  }, 7000); // TURN服务器可能需要更长时间，给7秒超时

                  pc.onicecandidate = (event) => {
                    // 当收到服务器反馈的ICE候选时，表示服务器可用
                    if (
                      event.candidate &&
                      event.candidate.candidate.includes("typ relay")
                    ) {
                      clearTimeout(timeout);
                      const latency = Date.now() - startTime;
                      resolve({
                        turnUrl: Array.isArray(turnServer.urls) ? turnServer.urls[0] : turnServer.urls,
                        urls: turnServer.urls,
                        username: turnServer.username,
                        credential: turnServer.credential,
                        success: true,
                        latency,
                      });
                      pc.close();
                    }
                  };
                });

                return icePromise;
              } catch (error) {
                return {
                  turnUrl: Array.isArray(turnServer.urls) ? turnServer.urls[0] : turnServer.urls,
                  urls: turnServer.urls,
                  username: turnServer.username,
                  credential: turnServer.credential,
                  success: false,
                  latency: Infinity,
                };
              }
            })
          );

          // 存储TURN测试结果供后续使用
          this.turnTestResults = turnTestResults;

          // 过滤成功连接的服务器并按响应时间排序
          const successfulStunServers = stunTestResults
            .filter((result) => result.success)
            .sort((a, b) => a.latency - b.latency);

          // 过滤成功连接的TURN服务器并按响应时间排序
          const successfulTurnServers = turnTestResults
            .filter((result) => result.success)
            .sort((a, b) => a.latency - b.latency);

          if (successfulStunServers.length > 0) {
            const fastestServer = successfulStunServers[0];
            this.logEvent(
              `找到最快的STUN服务器: ${fastestServer.stunUrl} (延迟: ${fastestServer.latency}ms)`
            );

            // 重新排序iceServers，将最快的服务器放在首位
            iceServers.push({ urls: fastestServer.stunUrl });

            // 设置最快的STUN服务器为活跃服务器，包含延迟信息
            this.activeStunServer = {
              url: fastestServer.stunUrl,
              latency: fastestServer.latency,
              priority: "high",
              selected: true,
              active: true,
            };

            // 通知STUN服务器变化
            this._notifyStunServerChange();
          } else {
            this.logEvent("未找到可用的STUN服务器，使用默认配置");
          }

          // 添加可用的TURN服务器到ICE服务器列表
          if (successfulTurnServers.length > 0) {
            const fastestTurn = successfulTurnServers[0];
            this.logEvent(
              `找到最快的TURN服务器: ${fastestTurn.turnUrl} (延迟: ${fastestTurn.latency}ms)`
            );

            // 先不使用TURN，除非直连尝试失败
            this.activeTurnServer = {
              url: fastestTurn.turnUrl,
              urls: fastestTurn.urls, // 保存完整的 URLs 数组
              username: fastestTurn.username,
              credential: fastestTurn.credential,
              latency: fastestTurn.latency,
              priority: "high",
              selected: true,
              active: false, // 初始不激活
              status: "已找到但未连接", // 初始状态
            };

            // 通知TURN服务器变化
            this._notifyTurnServerChange();
          } else {
            this.logEvent("未找到可用的TURN服务器");

            this.activeTurnServer = {
              url: null,
              latency: null,
              active: false,
              status: "未找到可用服务器",
            };

            this._notifyTurnServerChange();
          }
        } catch (error) {
          this.logEvent(`测试ICE服务器失败: ${error.message}, 使用默认服务器`);
          console.error("Error testing ICE servers:", error);
        }

        // 初始化连接配置，先不包含TURN服务器
        const initialConfig = {
          debug: 2,
          config: {
            iceServers: iceServers,
          },
        };

        this.peer = new Peer(this.peerId, initialConfig);

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

          // 监听ICE连接状态，跟踪STUN服务器的使用情况
          if (this.peer._pc) {
            this.peer._pc.addEventListener("iceconnectionstatechange", () => {
              const state = this.peer._pc.iceConnectionState;
              if (state === "connected" || state === "completed") {
                // 当ICE连接成功时，假设使用了选定的STUN服务器
                if (!this.activeStunServer) {
                  this.activeStunServer = {
                    url: "stun:stun.l.google.com:19302", // 默认STUN服务器
                    priority: "normal",
                    selected: true,
                  };
                }
                this._notifyStunServerChange();
              }
            });
          }
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

    // 增加连接尝试计数
    this.connectionAttempts++;

    // 检查是否应该使用TURN服务器
    const shouldUseTurn =
      this.connectionAttempts > this.maxDirectAttempts &&
      this.activeTurnServer &&
      (this.activeTurnServer.urls || this.activeTurnServer.url) &&
      !this.usingTurnServer;

    // 如果需要使用TURN服务器并且有可用的TURN服务器
    if (shouldUseTurn) {
      this.logEvent(
        `直接连接尝试失败 ${this.maxDirectAttempts} 次，尝试使用TURN服务器`
      );
      this.usingTurnServer = true;

      // 创建包含TURN服务器的新配置
      const turnConfig = {
        iceServers: [
          // 包含原有的STUN服务器
          ...(this.activeStunServer
            ? [{ urls: this.activeStunServer.url }]
            : []),
          // 添加TURN服务器（使用完整的配置）
          {
            urls: this.activeTurnServer.urls || this.activeTurnServer.url,
            username: this.activeTurnServer.username,
            credential: this.activeTurnServer.credential,
          },
        ],
      };

      // 更新TURN服务器状态
      this.activeTurnServer.active = true;
      this.activeTurnServer.status = "已连接"; // 直接显示为已连接，避免"正在连接中"状态
      this._notifyTurnServerChange();

      // 重新初始化peer对象，使用包含TURN服务器的配置
      if (this.peer) {
        this.peer.destroy();
      }

      this.peer = new Peer(this.peerId, {
        debug: 2,
        config: turnConfig,
      });

      // 设置新的peer事件处理
      this.peer.on("open", (id) => {
        this.logEvent(`使用TURN服务器的Peer ID已生成: ${id}`);
        this.initialized = true;
      });

      this.peer.on("error", (err) => {
        this.logEvent(
          `使用TURN服务器时发生错误: ${err.type} - ${err.message}`,
          "error"
        );
      });

      this.peer.on("connection", (conn) => {
        this.handleConnection(conn, true); // 指定这是通过TURN服务器的连接
      });

      this.peer.on("call", (call) => {
        this.logEvent(`接收到通过TURN服务器的媒体流呼叫`);
        call.answer();

        call.on("stream", (stream) => {
          this.logEvent(`接收到通过TURN服务器的远程媒体流`);
          if (this.mediaCallbacks.onStream) {
            this.mediaCallbacks.onStream(stream, call.metadata?.type);
          }
          if (this.onStream) this.onStream(stream);
        });
      });
    }

    // 如果上述条件都不满足，创建新连接
    this.logEvent(
      `正在连接到对方: ${remotePeerId}${
        shouldUseTurn ? " (通过TURN服务器)" : ""
      }`
    );

    // 关闭任何现有连接以避免并发连接问题
    if (this.connection) {
      this.logEvent(`关闭现有连接以创建新连接`);
      this.connection.close();
    }

    // 使用优化的连接配置以提高传输性能
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      serialization: "binary", // 二进制传输，性能更好
      chunked: true, // 启用数据分块，支持传输大文件
      // 添加性能优化配置
      label: 'file-transfer', // 标识为文件传输通道
      ordered: true, // 保证数据顺序
      maxRetransmits: 3, // 最大重传次数
    });

    this.handleConnection(conn, shouldUseTurn);

    return new Promise((resolve, reject) => {
      // 设置连接超时
      const timeout = setTimeout(() => {
        this.logEvent(`创建连接到 ${remotePeerId} 超时，放弃连接`);
        reject(new Error("Connection timeout"));
      }, 15000);

      conn.on("open", () => {
        clearTimeout(timeout);
        this.logEvent(
          "已成功" + (shouldUseTurn ? "通过TURN服务器" : "") + "连接到对方"
        );

        // 如果使用了TURN服务器，更新状态
        if (shouldUseTurn && this.activeTurnServer) {
          this.activeTurnServer.status = "已连接";
          this.activeTurnServer.active = true; // 确保active为true
          this.usingTurnServer = true; // 明确标记为使用TURN
          this._notifyTurnServerChange();

          // 只发送一次状态同步
          setTimeout(() => {
            this.synchronizeTurnState();
          }, 1000);
        }

        resolve(conn);
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        this.logEvent(`连接错误: ${err.message}`);

        // 如果使用了TURN服务器但失败了，更新状态
        if (shouldUseTurn && this.activeTurnServer) {
          this.activeTurnServer.status = "连接失败";
          this.activeTurnServer.active = false;
          this._notifyTurnServerChange();
        }

        reject(err);
      });
    });
  }

  handleConnection(conn, isTurnConnection = false) {
    this.connection = conn;
    this.logEvent(
      `建立了新连接: ${conn.peer}${isTurnConnection ? " (通过TURN服务器)" : ""}`
    );

    // 添加一个标志来跟踪连接状态
    this.connectionOpen = false;

    // 记录是否通过TURN建立的连接
    this.isTurnConnection = isTurnConnection;

    conn.on("open", () => {
      this.logEvent(
        `连接打开: ${conn.peer}${isTurnConnection ? " (通过TURN服务器)" : ""}`
      );
      this.connectionOpen = true; // 设置连接状态为已打开

      // 立即开始测量延迟
      setTimeout(() => {
        this.startLatencyMeasurement((latency) => {
          this.latency = latency;
        });
      }, 1000);

      // 改进：连接建立后，发送完整连接信息，确保对方知道我们的TURN状态
      if (this.connection && this.connection.open) {
        try {
          // 如果我们是通过TURN服务器连接的，确保状态为活跃
          if (isTurnConnection && this.activeTurnServer) {
            this.activeTurnServer.active = true;
            this.activeTurnServer.status = "已连接";
            this.usingTurnServer = true;
            this._notifyTurnServerChange();
          }

          this.connection.send({
            type: "connection-info",
            usingTurnRelay: this.isUsingTurnRelay(),
            timestamp: Date.now(),
            turnServer: this.activeTurnServer
              ? {
                  url: this.activeTurnServer.url || (Array.isArray(this.activeTurnServer.urls) ? this.activeTurnServer.urls[0] : this.activeTurnServer.urls),
                  urls: this.activeTurnServer.urls,
                  username: this.activeTurnServer.username,
                  credential: this.activeTurnServer.credential,
                  status: "已连接",
                  active: true,
                  latency: this.activeTurnServer.latency,
                }
              : null,
          });

          // 短暂延迟后再次发送，确保接收方收到
          setTimeout(() => {
            this.synchronizeTurnState();
          }, 1000);
        } catch (error) {
          console.error("发送连接信息失败:", error);
        }
      }

      // 如果是通过TURN建立的连接，更新状态并通知对方
      if (isTurnConnection) {
        this.usingTurnServer = true;
        this.isTurnConnection = true;

        if (this.activeTurnServer) {
          this.activeTurnServer.active = true;
          this.activeTurnServer.status = "已连接";
          this._notifyTurnServerChange();
        }

        // 连接建立后只发送一次状态同步信息
        setTimeout(() => {
          this.synchronizeTurnState();
        }, 1000);
      }

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

  // 修改的数据处理逻辑 - 修复文件开始事件处理
  handleData(data) {
    // 记录当前正在处理的文件块元数据，用于后续处理二进制数据
    if (
      typeof data === "object" &&
      data !== null &&
      data.type === "file-chunk-meta"
    ) {
      this.currentFileChunk = {
        fileId: data.fileId,
        chunkIndex: data.chunkIndex,
        size: data.size,
        timestamp: Date.now(),
        currentChunkSize: data.currentChunkSize, // 保存当前块大小信息
      };

      // 如果接收到新的块大小信息，通知UI更新
      if (data.currentChunkSize && this.fileMetadata[data.fileId]) {
        if (this.fileMetadata[data.fileId].chunkSize !== data.currentChunkSize) {
          this.fileMetadata[data.fileId].chunkSize = data.currentChunkSize;
          this.logEvent(`块大小更新: 文件${data.fileId}的块大小调整为${this.formatBytes(data.currentChunkSize)}`);
          
          // 分发块大小变更事件
          window.dispatchEvent(new CustomEvent('chunk-size-change', { 
            detail: {
              fileId: data.fileId,
              chunkSize: data.currentChunkSize,
              timestamp: Date.now()
            }
          }));
        }
      }
      return; // 等待后续的二进制块到达
    }

    // 处理二进制数据块 - 前提是之前收到了对应的元数据
    if (
      (data instanceof Blob ||
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data)) &&
      this.currentFileChunk
    ) {
      // 使用前面收到的元数据
      const { fileId, chunkIndex } = this.currentFileChunk;
      const timestamp = Date.now();

      // 检查元数据是否过期（如果超过10秒，可能是错误的数据流）
      if (timestamp - this.currentFileChunk.timestamp > 10000) {
        this.logEvent(`忽略过时的二进制数据块，元数据已过期`, "warn");
        this.currentFileChunk = null;
        return;
      }

      if (!this.fileChunks[fileId]) {
        this.logEvent(`接收到文件块数据但无相关文件信息: ${fileId}`, "error");
        this.currentFileChunk = null;
        return;
      }

      // 确保是有效的Uint8Array
      const processData = async () => {
        try {
          let processedData;

          if (data instanceof Blob) {
            // 如果是Blob，转换为ArrayBuffer
            const arrayBuffer = await data.arrayBuffer();
            processedData = new Uint8Array(arrayBuffer);
          } else if (data instanceof ArrayBuffer) {
            processedData = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            processedData = new Uint8Array(data.buffer);
          } else {
            throw new Error("不支持的二进制数据类型");
          }

          // 存储文件块
          this.fileChunks[fileId][chunkIndex] = processedData;
          this.fileMetadata[fileId].receivedChunks++;

          // 计算已接收的字节数
          const receivedBytes = this.fileChunks[fileId].reduce(
            (sum, chunk) => sum + (chunk ? chunk.byteLength : 0),
            0
          );

          // 修复进度计算：使用字节进度而不是块进度，避免块大小变化影响进度条
          const fileTotalBytes = this.fileMetadata[fileId].size || 0;
          const progress = fileTotalBytes > 0 ? (receivedBytes / fileTotalBytes) * 100 : 0;

          // 计算接收速度 (字节/秒)
          const now = Date.now();
          const startTime = this.fileMetadata[fileId].startTime || now;
          if (!this.fileMetadata[fileId].startTime) {
            this.fileMetadata[fileId].startTime = now;
            this.fileMetadata[fileId].lastUpdateTime = now;
            this.fileMetadata[fileId].lastBytes = 0;
          }

          const elapsedTotal = (now - startTime) / 1000; // 总经过时间(秒)
          const elapsedSinceLastUpdate =
            (now - this.fileMetadata[fileId].lastUpdateTime) / 1000;

          let speed = 0;

          // 计算平均速度和最近速度的加权平均
          if (elapsedTotal > 0) {
            const avgSpeed = receivedBytes / elapsedTotal;

            // 计算自上次更新以来的速度
            const recentSpeed =
              elapsedSinceLastUpdate > 0
                ? (receivedBytes - (this.fileMetadata[fileId].lastBytes || 0)) /
                  elapsedSinceLastUpdate
                : 0;

            // 加权平均，将最近速度权重设为70%
            speed =
              recentSpeed > 0 ? recentSpeed * 0.7 + avgSpeed * 0.3 : avgSpeed;
          }

          // 更新最后检查点
          this.fileMetadata[fileId].lastUpdateTime = now;
          this.fileMetadata[fileId].lastBytes = receivedBytes;

          // 计算预估剩余时间(秒)
          const totalBytes = this.fileMetadata[fileId].size || 0;
          const remainingBytes = totalBytes - receivedBytes;
          const remainingTime = speed > 0 ? remainingBytes / speed : 0;

          // 分发详细进度事件
          if (this.onData)
            this.onData({
              type: "file-progress",
              fileId: fileId,
              fileName: this.fileMetadata[fileId].name,
              progress: progress,
              speed: speed,
              remainingTime: remainingTime,
              sentBytes: receivedBytes,
              totalBytes: this.fileMetadata[fileId].size || 0,
            });

          // 全局事件 - 增加详细参数
          this.dispatchProgressEvent(
            fileId,
            this.fileMetadata[fileId].name,
            progress,
            speed,
            remainingTime,
            receivedBytes,
            this.fileMetadata[fileId].size || 0
          );

          // 向对方发送进度通知
          this.notifyProgressToSender(
            fileId,
            this.fileMetadata[fileId].name,
            progress,
            speed,
            remainingTime,
            receivedBytes,
            totalBytes
          );

          // 修复完成判断：基于字节数而不是块数，避免动态块大小调整导致的错误判断
          const expectedFileSize = this.fileMetadata[fileId].size || 0;
          const isFileComplete = expectedFileSize > 0 && receivedBytes >= expectedFileSize;
          
          if (isFileComplete) {
            this.logEvent(`文件接收完成判断: ${receivedBytes}/${expectedFileSize} 字节`, "info");
            this.reconstructFile(fileId);
          }

          // 清除当前块信息，准备处理下一块
          this.currentFileChunk = null;
        } catch (error) {
          this.logEvent(`处理二进制文件块失败: ${error.message}`, "error");
          console.error("处理二进制文件块错误:", error);
          this.currentFileChunk = null; // 确保清理状态
        }
      };

      // 处理二进制数据
      processData();
      return;
    }

    // 处理对象类型的数据（json序列化模式）
    if (typeof data === "object" && data !== null) {
      // 改进：处理连接信息数据包，完整同步TURN状态
      if (data.type === "connection-info") {
        // 避免重复处理相同的消息，记录最后处理的消息时间戳
        if (
          this._lastConnectionInfoTime &&
          data.timestamp &&
          Date.now() - this._lastConnectionInfoTime < 3000 &&
          data.timestamp <= this._lastConnectionInfoMsgTime
        ) {
          return; // 短时间内忽略重复或较旧的消息
        }

        this._lastConnectionInfoTime = Date.now();
        this._lastConnectionInfoMsgTime = data.timestamp || Date.now();

        // 只处理带有TURN信息的消息
        if (data.turnServer && data.turnServer.url) {
          this.logEvent("收到对方的TURN服务器信息");

          // 如果对方指示正在使用TURN中继，则我们也设置为TURN中继
          if (data.usingTurnRelay) {
            // 防止重复日志
            if (!this.usingTurnServer || !this.isTurnConnection) {
              this.logEvent("对方通过TURN服务器进行连接");
            }

            this.usingTurnServer = true;
            this.isTurnConnection = true;

            // 更新TURN服务器信息
            this.activeTurnServer = {
              url: data.turnServer.url,
              username:
                data.turnServer.username || this.activeTurnServer?.username,
              credential:
                data.turnServer.credential || this.activeTurnServer?.credential,
              status: "已连接",
              active: true,
              latency:
                data.turnServer.latency || this.activeTurnServer?.latency,
            };

            // 通知TURN服务器状态变化 - 限制通知频率
            if (
              !this._lastTurnNotifyTime ||
              Date.now() - this._lastTurnNotifyTime > 5000
            ) {
              this._lastTurnNotifyTime = Date.now();
              this._notifyTurnServerChange();
            }
          }
        }
        return; // 处理完连接信息后返回
      }

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
          // if (chunkIndex === 0 || chunkIndex % 50 === 0) {
          //   this.logEvent(
          //     `接收到文件块 #${chunkIndex}, 大小: ${processedData.byteLength} 字节`
          //   );
          // }

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
              startTime: Date.now(), // 添加开始时间
              lastUpdateTime: Date.now(), // 添加最后更新时间
              lastBytes: 0, // 添加最后接收的字节数
              chunkSize: data.chunkSize || 64 * 1024, // 记录发送方的块大小
            };
            this.fileChunks[data.fileId] = [];

            this.logEvent(
              `文件传输开始: ${data.fileName} (${Math.round(
                data.fileSize / 1024
              )} KB), 初始块大小: ${this.formatBytes(data.chunkSize || 64 * 1024)}`
            );

            // 添加：立即发送一个进度为0的事件，让接收方立即显示进度条
            const startEvent = new CustomEvent("file-progress", {
              detail: {
                fileId: data.fileId,
                fileName: data.fileName,
                progress: 0,
                speed: 0,
                remainingTime: Infinity,
                isReceiving: true, // 标记为接收方事件
                sentBytes: 0,
                totalBytes: data.fileSize,
              },
            });
            window.dispatchEvent(startEvent);

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

            if (fileId) {
              // 计算已接收的字节数进行判断
              const receivedBytes = this.fileChunks[fileId] ? 
                this.fileChunks[fileId].reduce((sum, chunk) => sum + (chunk ? chunk.byteLength : 0), 0) : 0;
              const expectedBytes = this.fileMetadata[fileId].size || 0;
              
              if (receivedBytes < expectedBytes) {
                this.logEvent(
                  `文件未完全接收，已接收${receivedBytes}/${expectedBytes}字节 (${Math.round((receivedBytes/expectedBytes)*100)}%)`,
                  "warn"
                );

                // 如果接收了超过95%的字节，尝试重建
                if (expectedBytes > 0 && receivedBytes >= expectedBytes * 0.95) {
                  this.logEvent(
                    `尝试重建部分接收的文件: ${data.fileName}`,
                    "warn"
                  );
                  this.reconstructFile(fileId);
                }
              } else {
                // 文件已完全接收
                this.logEvent(`文件完全接收: ${data.fileName} (${receivedBytes}字节)`, "info");
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

          // 新增: 处理从对方发来的文件传输进度信息
          case "file-transfer-progress":
            // 为接收方分发传输进度事件
            try {
              const event = new CustomEvent("file-progress", {
                detail: {
                  fileId: data.fileId,
                  fileName: data.fileName,
                  progress: data.progress,
                  speed: data.speed,
                  remainingTime: data.remainingTime,
                  isReceiving: true, // 标记为接收方事件
                  sentBytes: data.sentBytes,
                  totalBytes: data.totalBytes,
                },
              });
              window.dispatchEvent(event);

              // 每25%记录一次接收进度
              // if (Math.floor(data.progress) % 25 === 0 || data.progress >= 99.9) {
              //   this.logEvent(`文件接收进度 ${data.fileName}: ${Math.floor(data.progress)}%`);
              // }
            } catch (error) {
              console.error("处理接收进度事件失败:", error);
            }

            return; // 处理完进度信息后返回

          // 新增：处理从接收方发回的进度反馈，更新发送方的远程接收字节数
          case "file-receive-progress":
            try {
              // 更新发送方的远程接收进度跟踪
              if (this._fileTransfers && this._fileTransfers[data.fileId]) {
                this._fileTransfers[data.fileId].remoteReceivedBytes = data.receivedBytes || 0;
                this._fileTransfers[data.fileId].lastRemoteUpdate = Date.now();
                
                // 记录接收方进度（每10%记录一次，减少日志量）
                if (Math.floor(data.progress) % 10 === 0 || data.progress >= 99.9) {
                  const mbReceived = (data.receivedBytes || 0) / (1024 * 1024);
                  const mbSent = this._fileTransfers[data.fileId].sentBytes / (1024 * 1024);
                  const diff = mbSent - mbReceived;
                  this.logEvent(`接收方进度: ${data.fileName} ${data.progress.toFixed(1)}% (已收${mbReceived.toFixed(1)}MB, 差值${diff.toFixed(1)}MB)`);
                }
              }
              
              // 分发事件给UI组件
              window.dispatchEvent(new CustomEvent('file-receive-progress', { 
                detail: {
                  ...data,
                  isReceiving: false  // 这是接收方的接收进度，不是自己的接收进度
                }
              }));
            } catch (error) {
              console.error("处理接收方进度反馈失败:", error);
            }
            return;

          // 添加对块大小变更消息的处理
          case "chunk-size-change":
            this.handleChunkSizeChange(data);
            return; // 处理完毕，直接返回

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

  // 新增方法：向发送方直接发送进度通知
  notifyProgressToSender(
    fileId,
    fileName,
    progress,
    speed = 0,
    remainingTime = 0,
    receivedBytes = 0,
    totalBytes = 0
  ) {
    if (this.connection && this.connection.open) {
      try {
        // 限制发送频率，只在每5%进度变化时发送，或者特定节点（开始和结束）
        const sendFrequency = 5; // 每5%发送一次
        const lastProgress = this._lastNotifiedProgress?.[fileId] || 0;

        if (
          Math.floor(progress / sendFrequency) >
            Math.floor(lastProgress / sendFrequency) ||
          progress >= 99.9 ||
          progress <= 2 || // 确保开始和结束时发送更新
          !this._lastNotifiedTime?.[fileId] ||
          Date.now() - this._lastNotifiedTime[fileId] > 2000
        ) {
          // 最多每2秒发送一次

          // 初始化进度和时间跟踪对象
          if (!this._lastNotifiedProgress) this._lastNotifiedProgress = {};
          if (!this._lastNotifiedTime) this._lastNotifiedTime = {};

          // 更新跟踪状态
          this._lastNotifiedProgress[fileId] = progress;
          this._lastNotifiedTime[fileId] = Date.now();

          // 发送进度消息到对方
          this.connection.send({
            type: "file-receive-progress",
            fileId: fileId,
            fileName: fileName,
            progress: progress,
            speed: speed,
            remainingTime: progress >= 99.9 ? 0 : remainingTime,
            receivedBytes: receivedBytes,
            totalBytes: totalBytes,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        console.error("向发送方发送进度更新失败:", error);
      }
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

          // if (i === 0 || i === chunks.length - 1 || i % 100 === 0) {
          //   this.logEvent(
          //     `块 ${i}: 类型=${chunk.constructor.name}, 大小=${chunk.byteLength} 字节`
          //   );
          // }
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

  // 发送文件 - 修改为使用二进制数据发送
  async sendFile(file, externalFileId, chunkSize) {
    if (!this.connection) {
      this.logEvent("无法发送文件: 连接不存在");
      return false;
    }

    // 使用外部提供的ID或生成新ID
    const fileId =
      externalFileId ||
      `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 先检查文件是否合法
    if (!file || file.size === 0) {
      this.logEvent(`文件发送错误: 文件为空或无效`, "error");
      return Promise.reject(new Error("Invalid file"));
    }

    const fileReader = new FileReader();
    // 使用保守的初始块大小，然后动态调整
    chunkSize = chunkSize || 64 * 1024; // 从64KB开始，动态调整
    const totalChunks = Math.ceil(file.size / chunkSize);

    this.logEvent(
      `准备发送文件: ${file.name} (${Math.round(
        file.size / 1024
      )} KB), ID: ${fileId}, 初始块大小: ${chunkSize} 字节`
    );

    // 添加传输状态对象，用于跟踪传输进度
    this._fileTransfers = this._fileTransfers || {};
    this._fileTransfers[fileId] = {
      name: file.name,
      size: file.size,
      currentChunk: 0,
      totalChunks: totalChunks,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      sentBytes: 0,
      aborted: false,
      sizingAttempts: 0,
      lastErrorTime: 0,
      chunkSize: chunkSize,
      // 动态块大小调整相关字段
      dynamicChunkSize: chunkSize,
      lastSpeedCheck: Date.now(),
      remoteReceivedBytes: 0, // 对方已接收的字节数
      lastRemoteUpdate: Date.now(),
      speedHistory: [], // 传输速度历史
      chunkSizeHistory: [], // 块大小调整历史
      optimalChunkSize: chunkSize, // 最优块大小
    };

    // 发送文件开始信息 - 仍使用JSON发送元数据
    try {
      // 先记录开始发送的日志，确保顺序正确
      this.logEvent(
        `开始发送文件: ${file.name} (${Math.round(file.size / 1024)} KB)`
      );

      await new Promise((resolve) => setTimeout(resolve, 100)); // 短暂延迟让日志正确显示

      // 发送文件元数据（通过JSON）
      this.connection.send({
        type: "file-start",
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "application/octet-stream",
        totalChunks: totalChunks,
        chunkSize: chunkSize, // 添加初始块大小信息
      });

      // 增加一个较短的延迟，确保文件开始元数据被接收方处理
      await new Promise((resolve) => setTimeout(resolve, 50)); // 减少从300ms到50ms
    } catch (error) {
      this.logEvent(`发送文件元数据失败: ${error.message}`, "error");
      delete this._fileTransfers[fileId];
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let chunkIndex = 0;
      let retries = 0;
      const maxRetries = 3;
      let currentChunkSize = chunkSize; // 当前使用的块大小

      // 处理块大小自适应调整
      const handleMessageTooBigError = () => {
        // 如果错误是由于消息过大导致的
        const transfer = this._fileTransfers[fileId];
        if (!transfer) return false;

        // 限制尝试次数，避免无限循环
        transfer.sizingAttempts++;
        if (transfer.sizingAttempts >= 5) {
          this.logEvent(
            `已达到最大块大小调整尝试次数 (${transfer.sizingAttempts})，放弃传输`,
            "error"
          );
          return false;
        }

        // 将块大小减半并重新开始
        currentChunkSize = Math.floor(currentChunkSize / 2);
        if (currentChunkSize < 16 * 1024) {
          // 最小块大小为16KB
          this.logEvent(
            `块大小已达到最小值(${currentChunkSize}字节)，无法继续减小`,
            "error"
          );
          return false;
        }
        
        // 更新动态块大小
        transfer.dynamicChunkSize = currentChunkSize;
        transfer.chunkSize = currentChunkSize;

        this.logEvent(
          `检测到消息过大错误，将块大小从 ${transfer.chunkSize} 减小到 ${currentChunkSize} 字节`,
          "warn"
        );

        // 更新总块数
        const newTotalChunks = Math.ceil(file.size / currentChunkSize);
        transfer.totalChunks = newTotalChunks;

        // 重试当前块
        setTimeout(() => {
          const start = currentChunkSize * chunkIndex;
          const end = Math.min(file.size, start + currentChunkSize);
          try {
            fileReader.readAsArrayBuffer(file.slice(start, end));
          } catch (err) {
            reject(err);
          }
        }, 100);

        return true; // 表示已处理
      };

      // 新增：动态调整块大小的函数
      const adjustChunkSize = () => {
        const transfer = this._fileTransfers[fileId];
        if (!transfer) return currentChunkSize;

        const now = Date.now();
        // 每2秒检查一次
        if (now - transfer.lastSpeedCheck < 2000) {
          return currentChunkSize;
        }

        transfer.lastSpeedCheck = now;
        
        // 计算发送和接收的字节差
        const sentBytes = transfer.sentBytes;
        const receivedBytes = transfer.remoteReceivedBytes;
        const byteDifference = sentBytes - receivedBytes;
        
        // 转换为MB便于理解
        const mbDifference = byteDifference / (1024 * 1024);
        
        // 添加调试日志
        this.logEvent(`动态调整检查: 已发${this.formatBytes(sentBytes)}, 已收${this.formatBytes(receivedBytes)}, 差值${mbDifference.toFixed(1)}MB`, "debug");
        
        let newChunkSize = currentChunkSize;
        let reason = "";
        
        if (mbDifference < 15) {
          // 差值小于15MB，接收很快，可以增大块大小
          newChunkSize = Math.min(currentChunkSize * 1.5, 4 * 1024 * 1024); // 最大4MB
          reason = `接收良好(差值${mbDifference.toFixed(1)}MB < 15MB)，增大块大小`;
        } else if (mbDifference > 25) {
          // 差值大于25MB，接收跟不上，减小块大小
          newChunkSize = Math.max(currentChunkSize * 0.7, 16 * 1024); // 最小16KB
          reason = `接收滞后(差值${mbDifference.toFixed(1)}MB > 25MB)，减小块大小`;
        } else {
          // 15-25MB之间，速度匹配，保持当前块大小
          reason = `速度匹配(差值${mbDifference.toFixed(1)}MB)，保持块大小`;
        }
        
        // 确保块大小在合理范围内
        newChunkSize = Math.max(16 * 1024, Math.min(4 * 1024 * 1024, Math.floor(newChunkSize)));
        
        if (newChunkSize !== currentChunkSize) {
          this.logEvent(`动态调整: ${reason} ${this.formatBytes(currentChunkSize)} -> ${this.formatBytes(newChunkSize)}`);
          
          currentChunkSize = newChunkSize;
          transfer.dynamicChunkSize = newChunkSize;
          transfer.chunkSize = newChunkSize;
          
          // 记录块大小调整历史
          transfer.chunkSizeHistory.push({
            time: now,
            size: newChunkSize,
            reason: reason,
            byteDiff: byteDifference
          });
          
          // 更新总块数（仅用于统计，进度计算已改用字节进度）
          transfer.totalChunks = Math.ceil(file.size / newChunkSize);
        }
        
        return newChunkSize;
      };

      const readNextChunk = () => {
        // 检查传输是否已终止
        if (this._fileTransfers[fileId]?.aborted) {
          this.logEvent(`文件传输已终止: ${file.name}`, "warn");
          delete this._fileTransfers[fileId];
          reject(new Error("File transfer aborted"));
          return;
        }

        // 动态调整块大小
        currentChunkSize = adjustChunkSize();

        // 使用已发送的字节数作为起始位置，而不是chunkSize * chunkIndex
        // 因为块大小是动态变化的，所以不能用简单的乘法
        const start = this._fileTransfers[fileId].sentBytes;
        
        // 检查是否已经读取完所有字节
        if (start >= file.size) {
          this.logEvent(`文件已读取完毕，触发完成逻辑: ${file.name} (${start}/${file.size} 字节)`, "info");
          
          // 触发完成逻辑
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
              const transferTime = (endTime - this._fileTransfers[fileId].startTime) / 1000;
              const totalSentBytes = this._fileTransfers[fileId].sentBytes;
              const speedMBps = totalSentBytes / (1024 * 1024) / transferTime;

              this.logEvent(
                `文件发送完成: ${file.name} (速度: ${speedMBps.toFixed(2)} MB/s, 总共: ${this.formatBytes(totalSentBytes)})`
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
                sentBytes: totalSentBytes,
                chunkSize: currentChunkSize,
              });
            } catch (error) {
              this.logEvent(`发送文件完成事件失败: ${error.message}`, "error");
              delete this._fileTransfers[fileId];
              reject(error);
            }
          }, 300);
          
          return; // 不再读取更多数据
        }
        
        const end = Math.min(file.size, start + currentChunkSize);
        
        // 安全检查：确保不会读取超过文件大小的内容
        if (start >= file.size) {
          this.logEvent(`警告：尝试读取超出文件大小的位置 ${start}/${file.size}`, "warn");
          return;
        }
        
        if (end <= start) {
          this.logEvent(`警告：无效的文件切片范围 [${start}, ${end})`, "warn");
          return;
        }
        
        const actualChunkSize = end - start;
        this.logEvent(`读取文件块: [${start}, ${end}) 大小: ${this.formatBytes(actualChunkSize)}`, "debug");
        
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

          // 首先发送块元数据，告知接收方期望接收的是什么
          this.connection.send({
            type: "file-chunk-meta",
            fileId: fileId,
            chunkIndex: chunkIndex,
            size: arrayBuffer.byteLength,
            currentChunkSize: currentChunkSize, // 添加当前块大小信息
          });

          // 减少延迟后发送实际的二进制数据 - 从50ms减少到5ms
          setTimeout(() => {
            try {
              // 记录发送开始时间用于性能监控
              const chunkStartTime = Date.now();
              
              // 将ArrayBuffer转换为Blob并直接发送
              const blob = new Blob([arrayBuffer], {
                type: "application/octet-stream",
              });
              
              this.logEvent(`发送块 ${chunkIndex}: ${this.formatBytes(arrayBuffer.byteLength)} (总进度: ${Math.round((this._fileTransfers[fileId].sentBytes / file.size) * 100)}%)`, "debug");
              
              // 检查数据通道缓冲区状态
              if (this.connection && this.connection.dataChannel) {
                const bufferedAmount = this.connection.dataChannel.bufferedAmount;
                if (bufferedAmount > 16 * 1024 * 1024) { // 如果缓冲区超过16MB
                  this.logEvent(`数据通道缓冲区过大: ${this.formatBytes(bufferedAmount)}, 等待清空`, "warn");
                  // 延迟发送，等待缓冲区清空
                  setTimeout(() => {
                    this.connection.send(blob);
                  }, 100);
                  return;
                }
              }
              
              this.connection.send(blob);

              // 更新进度
              this._fileTransfers[fileId].currentChunk = chunkIndex + 1;

              // 更新发送字节数 - 使用实际字节数
              const sentBytes =
                this._fileTransfers[fileId].sentBytes + arrayBuffer.byteLength;
              this._fileTransfers[fileId].sentBytes = sentBytes;

              // 当前时间和性能监控
              const now = Date.now();
              const chunkTime = now - chunkStartTime;
              
              // 更新性能统计
              const transfer = this._fileTransfers[fileId];
              if (transfer.fastestChunkTime > chunkTime) transfer.fastestChunkTime = chunkTime;
              if (transfer.slowestChunkTime < chunkTime) transfer.slowestChunkTime = chunkTime;
              
              // 更新平均块时间
              const totalChunks = chunkIndex + 1;
              transfer.averageChunkTime = ((transfer.averageChunkTime * (totalChunks - 1)) + chunkTime) / totalChunks;

              // 计算传输速度（字节/秒）- 使用总时间，确保平均速度准确
              const elapsedSeconds =
                (now - this._fileTransfers[fileId].startTime) / 1000;
              const speed = elapsedSeconds > 0 ? sentBytes / elapsedSeconds : 0;

              // 计算预计剩余时间（秒）
              const remainingBytes = file.size - sentBytes;
              const estimatedTimeRemaining =
                speed > 0 ? remainingBytes / speed : 0;

              // 更新最后更新时间
              this._fileTransfers[fileId].lastUpdateTime = now;

              // 修复进度计算：使用字节进度而不是块进度，避免块大小变化影响进度条
              const progress = Math.min((sentBytes / file.size) * 100, 100);

              // 确保每次都发送完整的信息: 进度、速度和剩余时间
              this.dispatchProgressEvent(
                fileId,
                file.name,
                progress,
                speed,
                estimatedTimeRemaining,
                sentBytes,
                file.size,
                currentChunkSize // 添加块大小参数
              );

              retries = 0; // 重置重试计数
              chunkIndex++;

              // 修复完成判断：基于字节数而不是块数，避免动态块大小调整导致的错误判断
              const totalSentBytes = this._fileTransfers[fileId].sentBytes;
              const isComplete = totalSentBytes >= file.size;
              
              if (!isComplete) {
                // 继续发送下一块
                setTimeout(readNextChunk, 1);
              } else {
                // 所有字节已发送完成，发送完成信号
                this.logEvent(`所有数据块发送完成: ${file.name} (${totalSentBytes}/${file.size} 字节)`, "info");
                // 通过调用 readNextChunk 来触发完成逻辑
                setTimeout(readNextChunk, 1);
              }
            } catch (error) {
              if (
                error.message &&
                (error.message.includes("too big") ||
                  error.message.includes("Message too big") ||
                  error.message.includes("oversized") ||
                  error.message.includes("size exceeded"))
              ) {
                // 尝试减小块大小并重试
                if (handleMessageTooBigError()) {
                  return; // 已处理，直接返回
                }
              }

              this.logEvent(`发送二进制数据失败: ${error.message}`, "error");
              reject(error);
            }
          }, 5); // 减少到5ms延迟，确保元数据先到达但不影响速度
        } catch (error) {
          this.logEvent(`发送文件块元数据失败: ${error.message}`, "error");
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

  // 新增方法：分发进度事件，添加完成状态处理
  dispatchProgressEvent(
    fileId,
    fileName,
    progress,
    speed = 0,
    remainingTime = 0,
    sentBytes = 0,
    totalBytes = 0,
    chunkSize = 0 // 新增块大小参数
  ) {
    try {
      if (progress % 5 === 0 || progress >= 99.9) {
        console.log(
          `分发文件进度事件: ${fileName}, 进度: ${progress.toFixed(
            1
          )}%, 速度: ${speed.toFixed(
            2
          )}字节/秒, 剩余时间: ${remainingTime.toFixed(
            1
          )}秒, 已传输: ${sentBytes}/${totalBytes}字节, 块大小: ${chunkSize}字节`
        );
      }

      // 本地进度事件，添加块大小信息
      const event = new CustomEvent("file-progress", {
        detail: {
          fileId: fileId,
          fileName: fileName,
          progress: progress,
          speed: speed,
          remainingTime: progress >= 99.9 ? 0 : remainingTime,
          isReceiving: false,
          sentBytes: sentBytes,
          totalBytes: totalBytes,
          chunkSize: chunkSize, // 传递块大小信息
        },
      });
      window.dispatchEvent(event);

      // 向对方发送进度信息，包括块大小
      if (this.connection && this.connection.open) {
        try {
          // 大幅增加发送频率：每1%发送一次，或速度变化超过10%时发送
          const sendFrequency = 1; // 每1%发送一次进度更新
          const lastProgress =
            this._fileTransfers[fileId]?.lastSentProgress || 0;
          const lastSpeed = this._fileTransfers[fileId]?.lastSentSpeed || 0;
          const speedDiff =
            lastSpeed > 0 ? Math.abs(speed - lastSpeed) / lastSpeed : 1;

          if (
            Math.floor(progress / sendFrequency) >
              Math.floor(lastProgress / sendFrequency) ||
            progress >= 99.9 ||
            progress <= 2 || // 确保开始和结束时发送更新
            speedDiff > 0.1 ||
            !this._fileTransfers[fileId]?.lastSentTime ||
            Date.now() - this._fileTransfers[fileId]?.lastSentTime > 1000
          ) {
            if (!this._fileTransfers[fileId]) this._fileTransfers[fileId] = {};
            this._fileTransfers[fileId].lastSentProgress = progress;
            this._fileTransfers[fileId].lastSentSpeed = speed;
            this._fileTransfers[fileId].lastSentTime = Date.now();

            this.connection.send({
              type: "file-transfer-progress",
              fileId: fileId,
              fileName: fileName,
              progress: progress,
              speed: speed,
              remainingTime: progress >= 99.9 ? 0 : remainingTime,
              sentBytes: sentBytes,
              totalBytes: totalBytes,
              timestamp: Date.now(),
              chunkSize: chunkSize, // 传递块大小信息
            });
          }
        } catch (error) {
          console.error("发送进度更新到对方失败:", error);
        }
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

  // 新增：注册STUN服务器状态变化回调
  onSTUNServerChange(callback) {
    if (typeof callback === "function") {
      this.stunServerCallbacks.push(callback);

      // 如果已有活跃的STUN服务器信息，立即通知
      if (this.activeStunServer) {
        callback(this.activeStunServer);
      }
    }
    return this;
  }

  // 新增：通知STUN服务器变化
  _notifyStunServerChange() {
    const stunInfo = this.activeStunServer;
    for (const callback of this.stunServerCallbacks) {
      try {
        callback(stunInfo);
      } catch (error) {
        console.error("Error in STUN server change callback:", error);
      }
    }
  }

  // 新增：注册TURN服务器状态变化回调
  onTURNServerChange(callback) {
    if (typeof callback === "function") {
      this.turnServerCallbacks.push(callback);

      // 如果已有活跃的TURN服务器信息，立即通知
      if (this.activeTurnServer) {
        callback(this.activeTurnServer);
      }
    }
    return this;
  }

  // 新增：通知TURN服务器变化
  _notifyTurnServerChange() {
    const turnInfo = this.activeTurnServer;
    for (const callback of this.turnServerCallbacks) {
      try {
        callback(turnInfo);
      } catch (error) {
        console.error("Error in TURN server change callback:", error);
      }
    }
  }

  // 改进：判断当前连接是否使用TURN中继 - 考虑双方同步状态
  isUsingTurnRelay() {
    return this.usingTurnServer || this.isTurnConnection; // 任一为true即认为使用TURN中继
  }

  // 改进：主动同步TURN服务器状态，确保双方一致
  synchronizeTurnState() {
    if (!this.connection || !this.connection.open) return;

    // 防止频繁同步，设置最小同步间隔
    if (this._lastSyncTime && Date.now() - this._lastSyncTime < 5000) {
      return; // 5秒内不重复同步
    }

    this._lastSyncTime = Date.now();

    try {
      // 发送完整的TURN服务器信息
      this.connection.send({
        type: "connection-info",
        usingTurnRelay: this.isUsingTurnRelay(),
        timestamp: Date.now(),
        turnServer: this.activeTurnServer
          ? {
              url: this.activeTurnServer.url,
              username: this.activeTurnServer.username,
              credential: this.activeTurnServer.credential,
              status: "已连接",
              active: true,
              latency: this.activeTurnServer.latency,
            }
          : null,
      });
    } catch (error) {
      console.error("同步TURN状态失败:", error);
    }
  }

  // 辅助函数: 格式化字节大小 (如果没有引入外部的工具函数)
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  // 添加处理动态块大小变更的方法
  updateChunkSize(fileId, newChunkSize) {
    if (this._fileTransfers && this._fileTransfers[fileId]) {
      const oldChunkSize = this._fileTransfers[fileId].chunkSize;
      this._fileTransfers[fileId].chunkSize = newChunkSize;

      // 重新计算总块数
      const file = this._fileTransfers[fileId];
      if (file) {
        const totalChunks = Math.ceil(file.size / newChunkSize);
        file.totalChunks = totalChunks;

        this.logEvent(
          `已将文件 ${file.name} 的块大小从 ${oldChunkSize} 字节更新为 ${newChunkSize} 字节，总块数: ${totalChunks}`
        );
      }

      return true;
    }
    return false;
  }

  // 添加处理块大小改变事件的方法
  handleChunkSizeChange(data) {
    if (data && data.fileId && data.chunkSize) {
      const { fileId, chunkSize } = data;

      this.logEvent(
        `收到块大小变更通知：文件 ${fileId} 的块大小调整为 ${chunkSize} 字节`
      );

      // 更新发送任务的块大小
      this.updateChunkSize(fileId, chunkSize);

      // 分发为自定义事件，供UI组件使用
      const event = new CustomEvent("chunk-size-change", {
        detail: {
          fileId: fileId,
          chunkSize: chunkSize,
        },
      });
      window.dispatchEvent(event);

      return true;
    }
    return false;
  }
}

export default P2PConnection;
