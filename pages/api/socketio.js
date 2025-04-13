import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

// 统一过期时间 - 7天
const SESSION_EXPIRY = 604800; // 7天，单位秒

// 房间状态管理 - 内存缓存，主要数据存储在Redis中
const localRooms = {}; // 本地缓存，用于快速访问
const userSessions = {}; // 本地缓存，跟踪用户会话

// 定期清理过期的房间
const cleanupInterval = 3600000; // 1小时
const roomExpiry = 7200000; // 2小时

// 调试辅助函数
const debugLog = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
};

// Redis 实例和清理定时器
let globalPubClient = null;
let globalSubClient = null;
let cleanupTimer = null;

// Redis 键名生成函数
const redisKeys = {
  // 会话相关
  socketSession: (socketId) => `zstsess:socket:${socketId}`,
  sessionSocket: (sessionId) => `zstsess:session:${sessionId}`,
  // 会话备份索引 (新增)
  sessionBackup: (sessionId) => `zstsess:backup:${sessionId}`,
  // 房间相关
  roomInfo: (roomId) => `zstsess:room:${roomId}:info`,
  roomUsers: (roomId) => `zstsess:room:${roomId}:users`,
  roomInitiator: (roomId) => `zstsess:room:${roomId}:initiator`,
  // Socket.IO 原生键名
  socketioSession: (sid) => `socketio:${sid}`,
  // Socket.IO Engine会话数据
  engineSession: (sid) => `zstsess:engine:${sid}`,
  // 会话错误记录
  sessionError: (sessionId) => `zstsess:error:${sessionId}`
};

export default async function SocketHandler(req, res) {
  // 添加严格的响应头，防止缓存
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain');

  // 确保Redis连接正确初始化
  const setupRedisClients = async () => {
    if (globalPubClient && globalSubClient) {
      debugLog('复用现有Redis连接');
      return { pubClient: globalPubClient, subClient: globalSubClient };
    }

    if (!process.env.REDIS_URL) {
      debugLog('未配置REDIS_URL环境变量');
      return { pubClient: null, subClient: null };
    }

    try {
      debugLog('初始化新的Redis连接', { url: process.env.REDIS_URL.substring(0, 20) + '...' });
      
      const redisOptions = {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          debugLog(`Redis重试连接 (${times})，延迟 ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 5,
        enableReadyCheck: true,
        connectTimeout: 10000,
        disconnectTimeout: 2000,
        keepAlive: 10000,
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        }
      };

      const pubClient = new Redis(process.env.REDIS_URL, redisOptions);
      
      // 添加事件监听器
      pubClient.on('connect', () => {
        debugLog('Redis pubClient 连接已建立');
      });
      
      pubClient.on('ready', () => {
        debugLog('Redis pubClient 已就绪');
      });
      
      pubClient.on('error', (err) => {
        debugLog('Redis pubClient 错误', { error: err.message });
      });
      
      pubClient.on('reconnecting', () => {
        debugLog('Redis pubClient 重连中');
      });
      
      // 等待连接就绪
      await new Promise((resolve) => {
        if (pubClient.status === 'ready') {
          resolve();
        } else {
          pubClient.once('ready', resolve);
          // 添加超时
          setTimeout(resolve, 5000);
        }
      });
      
      // 复制连接
      const subClient = pubClient.duplicate(redisOptions);
      
      // 添加事件监听器
      subClient.on('connect', () => {
        debugLog('Redis subClient 连接已建立');
      });
      
      subClient.on('ready', () => {
        debugLog('Redis subClient 已就绪');
      });
      
      subClient.on('error', (err) => {
        debugLog('Redis subClient 错误', { error: err.message });
      });
      
      // 等待连接就绪
      await new Promise((resolve) => {
        if (subClient.status === 'ready') {
          resolve();
        } else {
          subClient.once('ready', resolve);
          // 添加超时
          setTimeout(resolve, 5000);
        }
      });
      
      // 保存全局引用
      globalPubClient = pubClient;
      globalSubClient = subClient;
      
      return { pubClient, subClient };
    } catch (error) {
      debugLog('Redis连接初始化失败', { error: error.message, stack: error.stack });
      return { pubClient: null, subClient: null };
    }
  };

  // Redis会话助手函数 - 集中处理Redis会话操作
  const redisSessionHelper = (pubClient) => {
    if (!pubClient) return null;
    
    return {
      // 存储Socket会话映射到Redis
      async storeSocketSession(socketId, sessionId) {
        try {
          // 主要映射关系
          await pubClient.pipeline()
            .set(redisKeys.socketSession(socketId), sessionId, 'EX', SESSION_EXPIRY)
            .set(redisKeys.sessionSocket(sessionId), socketId, 'EX', SESSION_EXPIRY)
            .exec();
            
          // 保存备份
          await this.saveSessionBackup(sessionId, socketId);
          await this.saveSessionBackup(sessionId, { 
            socketId, 
            lastUpdate: Date.now() 
          });
          
          return true;
        } catch (err) {
          debugLog('存储Socket会话失败', { error: err.message });
          return false;
        }
      },
      
      // 获取基于会话ID的Socket ID
      async getSocketIdBySessionId(sessionId) {
        try {
          return await pubClient.get(redisKeys.sessionSocket(sessionId));
        } catch (err) {
          debugLog('获取会话Socket ID失败', { error: err.message });
          return null;
        }
      },
      
      // 获取基于Socket ID的会话ID
      async getSessionIdBySocketId(socketId) {
        try {
          return await pubClient.get(redisKeys.socketSession(socketId));
        } catch (err) {
          debugLog('获取Socket会话ID失败', { error: err.message });
          return null;
        }
      },
      
      // 刷新会话过期时间
      async refreshSessionExpiry(socketId, sessionId) {
        try {
          await pubClient.pipeline()
            .expire(redisKeys.socketSession(socketId), SESSION_EXPIRY)
            .expire(redisKeys.sessionSocket(sessionId), SESSION_EXPIRY)
            .exec();
          return true;
        } catch (err) {
          debugLog('刷新会话过期时间失败', { error: err.message });
          return false;
        }
      },
      
      // 删除Socket会话
      async removeSocketSession(socketId) {
        try {
          const sessionId = await this.getSessionIdBySocketId(socketId);
          if (sessionId) {
            // 只删除socket到session的映射，保留session到socket的映射以便恢复
            await pubClient.del(redisKeys.socketSession(socketId));
          }
          return sessionId;
        } catch (err) {
          debugLog('删除Socket会话失败', { error: err.message });
          return null;
        }
      },
      
      // 存储房间信息
      async storeRoomInfo(roomId, info) {
        try {
          await pubClient.set(
            redisKeys.roomInfo(roomId), 
            JSON.stringify(info), 
            'EX', 
            SESSION_EXPIRY
          );
          return true;
        } catch (err) {
          debugLog('存储房间信息失败', { error: err.message });
          return false;
        }
      },
      
      // 获取房间信息
      async getRoomInfo(roomId) {
        try {
          const info = await pubClient.get(redisKeys.roomInfo(roomId));
          return info ? JSON.parse(info) : null;
        } catch (err) {
          debugLog('获取房间信息失败', { error: err.message });
          return null;
        }
      },
      
      // 更新房间活动时间
      async updateRoomActivity(roomId) {
        try {
          const info = await this.getRoomInfo(roomId);
          if (info) {
            info.lastActivity = Date.now();
            await this.storeRoomInfo(roomId, info);
            
            // 同时刷新所有与这个房间相关的键的过期时间
            await pubClient.pipeline()
              .expire(redisKeys.roomInfo(roomId), SESSION_EXPIRY)
              .expire(redisKeys.roomUsers(roomId), SESSION_EXPIRY)
              .expire(redisKeys.roomInitiator(roomId), SESSION_EXPIRY)
              .exec();
            
            return true;
          }
          return false;
        } catch (err) {
          debugLog('更新房间活动时间失败', { error: err.message });
          return false;
        }
      },
      
      // 添加用户到房间
      async addUserToRoom(roomId, sessionId, socketId) {
        try {
          // 使用Hash存储用户信息
          await pubClient.hset(
            redisKeys.roomUsers(roomId),
            sessionId,
            socketId
          );
          await pubClient.expire(redisKeys.roomUsers(roomId), SESSION_EXPIRY);
          return true;
        } catch (err) {
          debugLog('添加用户到房间失败', { error: err.message });
          return false;
        }
      },
      
      // 从房间中移除用户
      async removeUserFromRoom(roomId, sessionId) {
        try {
          await pubClient.hdel(redisKeys.roomUsers(roomId), sessionId);
          return true;
        } catch (err) {
          debugLog('从房间移除用户失败', { error: err.message });
          return false;
        }
      },
      
      // 获取房间中的所有用户
      async getRoomUsers(roomId) {
        try {
          const users = await pubClient.hgetall(redisKeys.roomUsers(roomId));
          return users || {};
        } catch (err) {
          debugLog('获取房间用户失败', { error: err.message });
          return {};
        }
      },
      
      // 检查房间是否为空
      async isRoomEmpty(roomId) {
        try {
          const userCount = await pubClient.hlen(redisKeys.roomUsers(roomId));
          return userCount === 0;
        } catch (err) {
          debugLog('检查房间是否为空失败', { error: err.message });
          return true; // 出错时假设房间为空
        }
      },
      
      // 设置房间发起者
      async setRoomInitiator(roomId, sessionId) {
        try {
          await pubClient.set(
            redisKeys.roomInitiator(roomId),
            sessionId,
            'EX',
            SESSION_EXPIRY
          );
          return true;
        } catch (err) {
          debugLog('设置房间发起者失败', { error: err.message });
          return false;
        }
      },
      
      // 获取房间发起者
      async getRoomInitiator(roomId) {
        try {
          return await pubClient.get(redisKeys.roomInitiator(roomId));
        } catch (err) {
          debugLog('获取房间发起者失败', { error: err.message });
          return null;
        }
      },
      
      // 清理Socket.IO会话
      async cleanupSocketIOSession(sid) {
        try {
          // 首先获取Engine会话信息
          const engineSession = await this.getEngineSession(sid);
          
          if (engineSession && engineSession.clientSessionId) {
            // 备份Engine会话数据
            await this.saveSessionBackup(engineSession.clientSessionId, { 
              engineSession: sid,
              lastSeen: Date.now(),
              wasCleanedUp: true
            });
          }
          
          // 删除主要keys
          await pubClient.del(redisKeys.socketioSession(sid));
          await pubClient.del(redisKeys.engineSession(sid));
          
          return true;
        } catch (err) {
          debugLog('清理Socket.IO会话失败', { error: err.message });
          return false;
        }
      },
      
      // 新增: 保存Socket.IO Engine会话
      async saveEngineSession(sid, data) {
        try {
          await pubClient.set(
            redisKeys.engineSession(sid),
            JSON.stringify(data),
            'EX',
            SESSION_EXPIRY
          );
          debugLog(`保存Engine会话数据: ${sid}`);
          return true;
        } catch (err) {
          debugLog('保存Engine会话数据失败', { error: err.message });
          return false;
        }
      },
      
      // 新增: 获取Socket.IO Engine会话
      async getEngineSession(sid) {
        try {
          const data = await pubClient.get(redisKeys.engineSession(sid));
          return data ? JSON.parse(data) : null;
        } catch (err) {
          debugLog('获取Engine会话数据失败', { error: err.message });
          return null;
        }
      },
      
      // 新增: 保存会话备份信息
      async saveSessionBackup(sessionId, data) {
        try {
          // 使用Hash存储会话的多个可能的socket ID和其他信息
          const backupKey = redisKeys.sessionBackup(sessionId);
          
          // 如果是socket ID值，添加到set中
          if (typeof data === 'string' && data.includes('-')) {
            await pubClient.sadd(`${backupKey}:sockets`, data);
            await pubClient.expire(`${backupKey}:sockets`, SESSION_EXPIRY);
          } else if (typeof data === 'object') {
            // 保存会话详细信息
            await pubClient.hset(backupKey, {
              ...data,
              timestamp: Date.now()
            });
            await pubClient.expire(backupKey, SESSION_EXPIRY);
          }
          return true;
        } catch (err) {
          debugLog('保存会话备份失败', { error: err.message });
          return false;
        }
      },
      
      // 新增: 获取会话备份的所有socket ID
      async getSessionBackupSockets(sessionId) {
        try {
          const backupKey = `${redisKeys.sessionBackup(sessionId)}:sockets`;
          const sockets = await pubClient.smembers(backupKey);
          return sockets || [];
        } catch (err) {
          debugLog('获取会话备份socket ID失败', { error: err.message });
          return [];
        }
      },
      
      // 新增: 获取会话备份详细信息
      async getSessionBackupInfo(sessionId) {
        try {
          const backupKey = redisKeys.sessionBackup(sessionId);
          const info = await pubClient.hgetall(backupKey);
          return info || null;
        } catch (err) {
          debugLog('获取会话备份信息失败', { error: err.message });
          return null;
        }
      },
      
      // 新增: 记录会话错误详情
      async logSessionError(sessionId, errorInfo) {
        try {
          await pubClient.set(
            redisKeys.sessionError(sessionId),
            JSON.stringify({
              ...errorInfo,
              timestamp: Date.now()
            }),
            'EX',
            300 // 5分钟过期
          );
          
          // 同时添加到备份信息中
          await this.saveSessionBackup(sessionId, {
            lastError: JSON.stringify(errorInfo),
            errorTime: Date.now()
          });
          
          return true;
        } catch (err) {
          debugLog('记录会话错误失败', { error: err.message });
          return false;
        }
      },
      
      // 新增: 获取会话错误详情
      async getSessionError(sessionId) {
        try {
          const error = await pubClient.get(redisKeys.sessionError(sessionId));
          return error ? JSON.parse(error) : null;
        } catch (err) {
          debugLog('获取会话错误信息失败', { error: err.message });
          return null;
        }
      }
    };
  };

  // 初始化Socket.IO服务器
  if (!res.socket.server.io) {
    try {
      debugLog('初始化Socket.io服务器');
      
      // 创建/获取Redis客户端
      const { pubClient, subClient } = await setupRedisClients();
      
      // 创建Redis会话助手
      const redisSession = redisSessionHelper(pubClient);
      
      // 创建Socket.IO服务器并配置
      const io = new Server(res.socket.server, {
        path: '/api/socketio',
        connectTimeout: 45000,         // 增加连接超时
        pingTimeout: 180000,           // 增加到3分钟
        pingInterval: 40000,           // 减少为40秒，更频繁地ping
        transports: ['polling'],       // 仅使用HTTP长轮询
        allowUpgrades: false,          // 禁止传输升级
        perMessageDeflate: false,      // 禁用消息压缩以简化处理
        httpCompression: false,        // 禁用HTTP压缩以减少CPU使用
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: false
        },
        // 会话设置
        cookie: false,                 // 禁用Cookie，我们将使用自定义会话管理
        // 无服务器环境优化
        serveClient: false,            // 不提供客户端代码
        maxHttpBufferSize: 1e7,        // 10MB缓冲区
        // 传输设置
        polling: {
          requestTimeout: 60000,       // 增加轮询请求超时到60秒
        },
        // 确保路径格式正确
        addTrailingSlash: false
      });
      
      // 创建自定义会话存储
      const sessionStore = new Map();
      
      // 设置Redis适配器
      if (pubClient && subClient) {
        try {
          debugLog('设置Redis适配器');
          const redisAdapter = createAdapter(pubClient, subClient, {
            // 添加自定义选项，改进会话恢复
            key: 'socketio',          // 自定义Redis key前缀
            requestsTimeout: 10000,    // 增加请求超时
            publishOnSpecificResponseChannel: true  // 优化消息传递
          });
          io.adapter(redisAdapter);
          
          debugLog('Redis适配器已设置，测试连接');
          // 测试适配器连接
          pubClient.set('socket:test', 'connected', 'EX', SESSION_EXPIRY);
          pubClient.get('socket:test', (err, result) => {
            if (err) {
              debugLog('Redis适配器测试失败', { error: err.message });
            } else {
              debugLog('Redis适配器测试成功', { result });
            }
          });
        } catch (adapterError) {
          debugLog('设置Redis适配器失败', { error: adapterError.message });
        }
      } else {
        debugLog('警告: Redis客户端未就绪，使用内存存储替代');
        // 这将导致在多实例环境中会话无法共享
      }
      
      // 设置Engine.IO错误处理
      io.engine.on('connection_error', async (err) => {
        debugLog(`Engine.IO 连接错误`, { error: err.message, code: err.code, context: err.context || 'unknown', req: err.req ? `${err.req.method} ${err.req.url}` : 'unknown' });
        
        // 针对会话ID未知错误的特殊处理
        if (err.message === "Session ID unknown" && err.req && pubClient) {
          const url = new URL(err.req.url, 'http://localhost');
          const sid = url.searchParams.get('sid');
          if (sid) {
            debugLog(`尝试恢复丢失的会话: ${sid}`);
            
            // 在Redis中查找此会话是否有记录
            try {
              // 首先尝试查找是否有Engine会话信息
              const engineSession = await redisSession.getEngineSession(sid);
              if (engineSession) {
                debugLog(`找到Engine会话数据: ${sid}`);
                
                // 获取与之关联的客户端会话ID
                const clientSessionId = engineSession.clientSessionId || url.searchParams.get('sessionId');
                
                if (clientSessionId) {
                  // 获取会话备份信息
                  const backupSockets = await redisSession.getSessionBackupSockets(clientSessionId);
                  debugLog(`会话 ${clientSessionId} 的备份socket IDs: ${backupSockets.length}`);
                  
                  const backupInfo = await redisSession.getSessionBackupInfo(clientSessionId);
                  debugLog(`会话 ${clientSessionId} 的备份信息:`, backupInfo);
                  
                  // 记录会话错误信息，包含尽可能多的上下文
                  const sessionErrorInfo = {
                    sid,
                    clientSessionId,
                    roomId: engineSession.roomId || url.searchParams.get('roomId'),
                    time: Date.now(),
                    error: 'session_id_unknown',
                    backupSocketCount: backupSockets.length,
                    hasBackupInfo: !!backupInfo,
                    engineSessionData: engineSession
                  };
                  
                  // 保存错误信息
                  await redisSession.logSessionError(clientSessionId, sessionErrorInfo);
                  
                  // 清理旧的Engine会话，让客户端可以重建
                  await redisSession.cleanupSocketIOSession(sid);
                  
                  // 尝试验证备份中的所有socket，可能有一个还是有效的
                  if (backupSockets.length > 0) {
                    for (const oldSocketId of backupSockets) {
                      // 尝试检查这个socket ID是否还有效
                      const oldSessionId = await redisSession.getSessionIdBySocketId(oldSocketId);
                      if (oldSessionId === clientSessionId) {
                        debugLog(`找到有效的备份socket: ${oldSocketId}`);
                        
                        // 重新生成主存储中的映射
                        await redisSession.storeSocketSession(oldSocketId, clientSessionId);
                      } else {
                        // 清理无效的备份socket
                        await pubClient.srem(`${redisKeys.sessionBackup(clientSessionId)}:sockets`, oldSocketId);
                      }
                    }
                  }
                }
              } else {
                debugLog(`未找到Engine会话数据: ${sid}`);
              }
              
              // 处理URL中提供的会话ID
              const clientSessionId = url.searchParams.get('sessionId');
              const roomId = url.searchParams.get('roomId');
              
              if (clientSessionId) {
                debugLog(`URL中包含会话ID: ${clientSessionId}`);
                
                // 找到与此会话ID关联的Socket ID
                const existingSocketId = await redisSession.getSocketIdBySessionId(clientSessionId);
                if (existingSocketId) {
                  debugLog(`找到关联的Socket ID: ${existingSocketId}`);
                  
                  // 建立一个新会话创建时间点的记录，帮助客户端决策
                  const sessionErrorInfo = {
                    sid: sid,
                    clientSessionId: clientSessionId,
                    roomId: roomId,
                    time: Date.now(),
                    oldSocketId: existingSocketId,
                    error: 'session_id_unknown'
                  };
                  
                  // 保存会话错误信息，以便客户端可以查询
                  await pubClient.set(
                    `zstsess:error:${clientSessionId}`, 
                    JSON.stringify(sessionErrorInfo),
                    'EX',
                    300 // 5分钟过期
                  );
                  
                  // 清理旧的Socket会话
                  await pubClient.del(redisKeys.socketSession(existingSocketId));
                  debugLog(`已清理旧的Socket会话: ${existingSocketId}`);
                }
              }
            } catch (e) {
              debugLog(`恢复会话过程中出错: ${e.message}`);
            }
          }
        }
      });
      
      // 监听HTTP长轮询请求错误
      io.engine.on('initialHeaders', (headers, req) => {
        // 添加自定义头以缓解缓存问题
        headers['X-Socket-Session-Time'] = Date.now().toString();
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
      });

      // 监听Engine初始握手
      io.engine.on('initial_headers', (headers, req) => {
        // 用于调试的唯一标识符
        headers['X-Connection-Id'] = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 7);
      });

      // 监听Socket.IO连接升级，记录有用的调试信息
      io.engine.on('headers', (headers, req) => {
        const url = new URL(req.url, 'http://localhost');
        const clientSessionId = url.searchParams.get('sessionId');
        
        if (clientSessionId) {
          // 在头信息中包含会话ID，帮助调试
          headers['X-Client-Session'] = clientSessionId.substring(0, 8);
        }
      });

      // 添加新的会话拦截逻辑
      io.engine.on('connection', async (socket) => {
        try {
          const handshake = socket.request;
          if (handshake && handshake._query) {
            const clientSessionId = handshake._query.sessionId;
            const roomId = handshake._query.roomId;
            
            // 保存Engine会话信息
            if (clientSessionId && socket.id && redisSession) {
              // 记录Engine会话数据，用于恢复
              const engineData = {
                id: socket.id,
                clientSessionId: clientSessionId,
                roomId: roomId,
                time: Date.now()
              };
              
              await redisSession.saveEngineSession(socket.id, engineData);
            }
          }
        } catch (error) {
          debugLog('处理Engine连接时出错', { error: error.message });
        }
      });

      // 添加更多的服务器事件监听器
      io.of('/').adapter.on('error', (err) => {
        debugLog('Socket.IO Adapter 错误', { error: err.message });
      });

      // 初始化清理定时器
      if (!cleanupTimer) {
        cleanupTimer = setInterval(async () => {
          debugLog('运行定期清理任务');
          
          // 使用Redis而不是内存来管理房间，定期检查活动状态
          if (pubClient) {
            try {
              // 获取所有以 zstsess:room: 开头的键
              const keys = await pubClient.keys('zstsess:room:*:info');
              debugLog(`找到 ${keys.length} 个房间信息`);
              
              const now = Date.now();
              let cleaned = 0;
              
              // 检查每个房间的活动时间
              for (const key of keys) {
                const roomId = key.split(':')[2]; // 从 zstsess:room:{roomId}:info 中提取
                const roomInfo = await redisSession.getRoomInfo(roomId);
                
                if (roomInfo && (now - roomInfo.lastActivity > roomExpiry)) {
                  debugLog(`清理过期房间: ${roomId}`);
                  
                  // 删除房间相关的所有键
                  await pubClient.del(redisKeys.roomInfo(roomId));
                  await pubClient.del(redisKeys.roomUsers(roomId));
                  await pubClient.del(redisKeys.roomInitiator(roomId));
                  
                  // 更新内存缓存
                  delete localRooms[roomId];
                  cleaned++;
                }
              }
              
              if (cleaned > 0) {
                debugLog(`已清理 ${cleaned} 个过期房间`);
              }
            } catch (err) {
              debugLog('Redis清理过程出错', { error: err.message });
            }
          }
          
          // 检查Redis连接是否健康
          if (pubClient) {
            pubClient.ping().then(() => {
              debugLog('Redis连接健康检查: 成功');
            }).catch(err => {
              debugLog('Redis连接健康检查: 失败', { error: err.message });
              // 尝试重新连接
              setupRedisClients().catch(e => {
                debugLog('重新连接Redis失败', { error: e.message });
              });
            });
          }
        }, cleanupInterval);
      }

      // Socket.IO连接处理
      io.on('connection', async (socket) => {
        const transport = socket.conn.transport.name;
        const query = socket.handshake.query || {};
        const clientSessionId = query.sessionId || null;
        const roomId = query.roomId || null;
        
        debugLog(`客户端连接: ${socket.id}`, {
          transport,
          clientSessionId,
          roomId,
          remoteAddress: socket.handshake.address,
          headers: {
            'user-agent': socket.handshake.headers['user-agent'],
            'x-forwarded-for': socket.handshake.headers['x-forwarded-for'] || 'none'
          }
        });

        // 添加新方法: 检查会话错误状态
        socket.on('check-session-error', async (sessionData) => {
          const { sessionId } = sessionData || {};
          
          if (!sessionId || !pubClient) {
            socket.emit('session-error-status', { found: false });
            return;
          }
          
          try {
            const errorData = await pubClient.get(`zstsess:error:${sessionId}`);
            if (errorData) {
              // 找到错误信息，发送给客户端
              const parsedData = JSON.parse(errorData);
              socket.emit('session-error-status', { 
                found: true, 
                data: parsedData 
              });
              
              // 清除错误信息，防止重复处理
              await pubClient.del(`zstsess:error:${sessionId}`);
            } else {
              socket.emit('session-error-status', { found: false });
            }
          } catch (err) {
            debugLog('检查会话错误状态失败', { error: err.message });
            socket.emit('session-error-status', { found: false, error: err.message });
          }
        });
        
        // 如果查询参数中有sessionId和roomId，尝试立即恢复会话
        if (clientSessionId && roomId && redisSession) {
          try {
            // 查询Redis中是否有此会话记录
            const oldSocketId = await redisSession.getSocketIdBySessionId(clientSessionId);
            
            if (oldSocketId) {
              debugLog(`恢复会话: ${clientSessionId}`, { oldSocketId, newSocketId: socket.id });
              
              // 更新Redis中的会话映射
              await redisSession.storeSocketSession(socket.id, clientSessionId);
              
              // 更新本地存储
              sessionStore.set(socket.id, clientSessionId);
              socket.sessionId = clientSessionId;
              
              // 检查用户是否在此房间中
              const roomUsers = await redisSession.getRoomUsers(roomId);
              
              if (roomUsers && roomUsers[clientSessionId]) {
                debugLog(`用户在房间 ${roomId} 中，更新Socket ID`);
                
                // 更新房间中的用户Socket ID
                await redisSession.addUserToRoom(roomId, clientSessionId, socket.id);
                
                // 更新房间活动时间
                await redisSession.updateRoomActivity(roomId);
                
                // 更新本地缓存
                if (!localRooms[roomId]) {
                  localRooms[roomId] = {
                    users: new Map(),
                    initiator: null,
                    lastActivity: Date.now()
                  };
                }
                
                localRooms[roomId].users.set(clientSessionId, socket.id);
                userSessions[socket.id] = { roomId, sessionId: clientSessionId };
                
                // 加入Socket.io房间
                socket.join(roomId);
                socket.roomId = roomId;
                
                // 获取发起方信息
                const initiator = await redisSession.getRoomInitiator(roomId);
                
                // 通知用户房间状态
                socket.emit('room-status', { 
                  shouldInitiate: initiator === clientSessionId, 
                  usersCount: Object.keys(roomUsers).length,
                  allSessions: Object.keys(roomUsers),
                  resumedSession: true
                });
              }
            }
          } catch (err) {
            debugLog(`恢复会话失败: ${err.message}`);
          }
        }
        
        // 存储会话ID到Redis以实现跨实例会话恢复
        socket.on('register-session', async (sessionId) => {
          if (!sessionId) {
            debugLog('客户端未提供会话ID', { socketId: socket.id });
            return;
          }
          
          debugLog(`注册会话ID: ${sessionId}`, { socketId: socket.id });
          
          // 记录到本地Map
          sessionStore.set(socket.id, sessionId);
          socket.sessionId = sessionId; // 直接在socket对象上存储
          
          // 存储到Redis
          if (redisSession) {
            // 首先检查这个会话ID是否已经有关联的socketId
            const existingSocketId = await redisSession.getSocketIdBySessionId(sessionId);
            if (existingSocketId && existingSocketId !== socket.id) {
              debugLog(`会话ID已关联到其他Socket: ${existingSocketId}, 更新为当前Socket: ${socket.id}`);
              
              // 保存旧的socket ID作为备份
              await redisSession.saveSessionBackup(sessionId, existingSocketId);
            }
            
            // 保存新的映射关系
            await redisSession.storeSocketSession(socket.id, sessionId);
            debugLog(`会话ID已存储到Redis: ${sessionId}`);
            
            // 获取Engine会话数据并保存，增强会话持久性
            const engineData = {
              id: socket.id,
              clientSessionId: sessionId,
              roomId: socket.roomId || socket.handshake.query.roomId,
              transport: socket.conn.transport.name,
              time: Date.now(),
              userAgent: socket.handshake.headers['user-agent']
            };
            
            await redisSession.saveEngineSession(socket.id, engineData);
            
            // 检查是否有会话错误记录
            const errorData = await redisSession.getSessionError(sessionId);
            if (errorData) {
              debugLog(`发现会话错误记录: ${sessionId}`, errorData);
              
              // 通知客户端有会话错误
              socket.emit('session-error-detected', errorData);
              
              // 清除错误记录
              await pubClient.del(redisKeys.sessionError(sessionId));
            }
          }
          
          // 回复客户端，确认会话已注册
          socket.emit('session-registered', { 
            success: true, 
            socketId: socket.id, 
            timestamp: Date.now() 
          });
        });
        
        // 客户端加入房间
        socket.on('join-room', async (roomId, sessionId) => {
          debugLog(`用户加入房间请求`, { socketId: socket.id, roomId, sessionId });
          
          // 检查会话ID格式
          if (!sessionId) {
            socket.emit('error', { message: '缺少会话ID' });
            return;
          }
          
          // 同时注册会话ID
          sessionStore.set(socket.id, sessionId);
          socket.sessionId = sessionId;
          
          // 存储到Redis
          if (redisSession) {
            await redisSession.storeSocketSession(socket.id, sessionId);
          }
          
          // 使用Redis存储房间信息
          if (redisSession) {
            // 检查房间是否存在
            let roomInfo = await redisSession.getRoomInfo(roomId);
            
            if (!roomInfo) {
              // 创建新房间
              roomInfo = {
                createdAt: Date.now(),
                lastActivity: Date.now()
              };
              
              // 存储房间信息
              await redisSession.storeRoomInfo(roomId, roomInfo);
              
              // 初始化本地缓存
              localRooms[roomId] = {
                users: new Map(),
                initiator: null,
                lastActivity: Date.now()
              };
              
              debugLog(`创建房间 ${roomId}`);
            }
            
            // 更新房间活动时间
            await redisSession.updateRoomActivity(roomId);
            
            // 获取房间中的用户
            const roomUsers = await redisSession.getRoomUsers(roomId);
            
            // 检查房间容量
            if (Object.keys(roomUsers).length >= 2) {
              // 检查请求者是否已经在房间中
              if (!roomUsers[sessionId]) {
                socket.emit('room-full');
                debugLog(`拒绝用户加入，房间已满`, { roomId, sessionId });
                return;
              } else {
                debugLog(`用户重新连接到已满房间`, { roomId, sessionId });
              }
            }
            
            // 添加用户到房间
            await redisSession.addUserToRoom(roomId, sessionId, socket.id);
            
            // 获取房间中的最新用户列表
            const updatedRoomUsers = await redisSession.getRoomUsers(roomId);
            
            // 更新本地缓存
            if (!localRooms[roomId]) {
              localRooms[roomId] = {
                users: new Map(),
                initiator: null,
                lastActivity: Date.now()
              };
            }
            
            // 更新房间用户在本地缓存中
            localRooms[roomId].users.clear();
            for (const [sid, socketId] of Object.entries(updatedRoomUsers)) {
              localRooms[roomId].users.set(sid, socketId);
            }
            
            // 更新用户会话映射
            userSessions[socket.id] = { roomId, sessionId };
            
            // 加入Socket.io房间
            socket.join(roomId);
            socket.roomId = roomId;
            
            // 确定发起方 - 第一个加入的用户是发起方
            let initiator = await redisSession.getRoomInitiator(roomId);
            
            if (Object.keys(updatedRoomUsers).length === 2 && !initiator) {
              // 获取所有会话ID，按照加入顺序（这里简化为第一个键）
              const allSessionIds = Object.keys(updatedRoomUsers);
              
              // 第一个加入的用户作为发起方
              initiator = allSessionIds[0];
              
              // 存储发起方信息
              await redisSession.setRoomInitiator(roomId, initiator);
              
              // 更新本地缓存
              localRooms[roomId].initiator = initiator;
              
              debugLog(`已确定发起方`, { roomId, initiator });
            }
            
            // 确定当前用户是否是发起方
            const shouldInitiate = initiator === sessionId;
            
            // 通知用户房间状态
            debugLog(`通知用户房间状态`, { socketId: socket.id, shouldInitiate, usersCount: Object.keys(updatedRoomUsers).length });
            socket.emit('room-status', { 
              shouldInitiate, 
              usersCount: Object.keys(updatedRoomUsers).length,
              allSessions: Object.keys(updatedRoomUsers)
            });
            
            // 通知其他人有新用户加入
            for (const [otherSessionId, otherSocketId] of Object.entries(updatedRoomUsers)) {
              if (otherSessionId !== sessionId) {
                debugLog(`通知其他用户有新成员加入`, { roomId, notifySessionId: otherSessionId });
                io.to(otherSocketId).emit('user-joined', { 
                  sessionId: sessionId,
                  timestamp: new Date().toISOString() 
                });
              }
            }
          } else {
            // 如果Redis不可用，则使用内存存储（保留原有逻辑）
          }
        });
        
        // WebRTC信令 - 优化转发逻辑
        socket.on('signal', async ({ roomId, signal, targetSessionId }) => {
          if (!roomId || !signal) {
            debugLog('收到无效信令数据');
            return;
          }
          
          const sessionId = socket.sessionId || sessionStore.get(socket.id);
          
          if (!sessionId) {
            debugLog('无法确定会话ID，丢弃信号', { socketId: socket.id });
            return;
          }
          
          // 记录信号类型
          debugLog(`收到信号 [${signal.type || 'candidate'}]`, { 
            from: sessionId, 
            roomId,
            targetSessionId
          });
          
          // 使用Redis更新房间活动时间
          if (redisSession) {
            await redisSession.updateRoomActivity(roomId);
          }
          
          // 优先使用指定目标
          if (targetSessionId) {
            let targetSocketId = null;
            
            // 首先尝试从本地缓存中获取
            if (localRooms[roomId] && localRooms[roomId].users.has(targetSessionId)) {
              targetSocketId = localRooms[roomId].users.get(targetSessionId);
            }
            
            // 如果本地没有找到，尝试从Redis获取
            if (!targetSocketId && redisSession) {
              const roomUsers = await redisSession.getRoomUsers(roomId);
              targetSocketId = roomUsers[targetSessionId];
              
              // 如果找到了，更新本地缓存
              if (targetSocketId && localRooms[roomId]) {
                localRooms[roomId].users.set(targetSessionId, targetSocketId);
              }
            }
            
            if (targetSocketId) {
              debugLog(`转发信号到特定目标 [${signal.type || 'candidate'}]`, { 
                from: sessionId, 
                to: targetSessionId 
              });
              io.to(targetSocketId).emit('signal', { 
                signal, 
                sessionId: sessionId 
              });
              return;
            } else {
              debugLog(`指定的目标会话ID不存在`, { targetSessionId });
            }
          }
          
          // 如果没有指定目标或目标不存在，转发给房间中的另一个用户
          if (redisSession) {
            const roomUsers = await redisSession.getRoomUsers(roomId);
            
            for (const [otherSessionId, otherSocketId] of Object.entries(roomUsers)) {
              if (otherSessionId !== sessionId) {
                debugLog(`转发信号给房间内其他用户`, { to: otherSessionId });
                io.to(otherSocketId).emit('signal', { 
                  signal, 
                  sessionId: sessionId 
                });
                return; // 只发给一个用户就返回，因为房间限制为2人
              }
            }
          } else if (localRooms[roomId]) {
            // 使用本地缓存
          }
        });
        
        // 断开连接处理
        socket.on('disconnect', async () => {
          debugLog(`客户端断开连接`, { socketId: socket.id });
          
          // 获取会话信息
          const sessionInfo = userSessions[socket.id];
          const sessionId = sessionInfo?.sessionId || sessionStore.get(socket.id);
          
          if (!sessionId) {
            debugLog(`无法找到断开连接的会话信息`, { socketId: socket.id });
            return;
          }
          
          const roomId = sessionInfo?.roomId;
          
          // 清理本地会话跟踪
          delete userSessions[socket.id];
          sessionStore.delete(socket.id);
          
          // Redis操作 - 只删除socket映射，保留session映射用于恢复
          if (redisSession) {
            await redisSession.removeSocketSession(socket.id);
            
            // 处理房间相关的信息
            if (roomId) {
              // 更新房间活动时间
              await redisSession.updateRoomActivity(roomId);
              
              // 检查同一会话ID是否有新的socket连接
              const currentSocketId = await redisSession.getSocketIdBySessionId(sessionId);
              
              // 只有当无新连接或当前socket就是断开的socket时才移除
              if (!currentSocketId || currentSocketId === socket.id) {
                debugLog(`从房间移除用户会话`, { roomId, sessionId });
                
                // 从房间中移除用户
                await redisSession.removeUserFromRoom(roomId, sessionId);
                
                // 检查发起方
                const initiator = await redisSession.getRoomInitiator(roomId);
                if (initiator === sessionId) {
                  // 清除发起方
                  await redisSession.setRoomInitiator(roomId, null);
                  debugLog(`发起方离开，重置发起方`, { roomId });
                }
                
                // 获取房间中的其他用户
                const roomUsers = await redisSession.getRoomUsers(roomId);
                
                // 通知其他用户
                for (const otherSocketId of Object.values(roomUsers)) {
                  io.to(otherSocketId).emit('peer-disconnected', { sessionId });
                }
                
                // 检查房间是否为空
                if (Object.keys(roomUsers).length === 0) {
                  debugLog(`房间已空，标记为待清理`, { roomId });
                  // 我们不立即删除房间，而是在定期清理任务中检查
                }
              } else {
                debugLog(`用户会话有新连接，不移除`, { sessionId, currentSocketId });
              }
              
              // 更新本地缓存
              if (localRooms[roomId]) {
                if (!currentSocketId || currentSocketId === socket.id) {
                  localRooms[roomId].users.delete(sessionId);
                } else {
                  // 更新为新的socketId
                  localRooms[roomId].users.set(sessionId, currentSocketId);
                }
              }
            }
          }
        });

        // 添加心跳检测处理
        socket.on('heartbeat', () => {
          // 获取当前会话ID
          const sessionId = socket.sessionId || sessionStore.get(socket.id) || null;
          
          socket.emit('heartbeat-response', { 
            timestamp: Date.now(),
            transport: socket.conn.transport.name,
            sessionId: sessionId || 'unknown'
          });
          
          // 如果有会话ID，刷新Redis中的过期时间
          if (sessionId && redisSession) {
            redisSession.refreshSessionExpiry(socket.id, sessionId)
              .catch(err => {
                debugLog('刷新会话过期时间失败', { error: err.message });
              });
            
            // 如果用户在房间中，也刷新房间活动时间
            if (socket.roomId) {
              redisSession.updateRoomActivity(socket.roomId)
                .catch(err => {
                  debugLog('刷新房间活动时间失败', { error: err.message });
                });
            }
          }
        });
        
        // 添加重连处理
        socket.on('reconnect-attempt', async (data) => {
          const { sessionId, roomId } = data || {};
          if (!sessionId) return;
          
          debugLog(`客户端尝试重连`, { sessionId, roomId, socketId: socket.id });
          
          // 更新会话映射
          sessionStore.set(socket.id, sessionId);
          socket.sessionId = sessionId;
          
          // 更新Redis中的会话信息
          if (redisSession) {
            await redisSession.storeSocketSession(socket.id, sessionId);
            
            // 如果提供了房间ID，尝试重新加入
            if (roomId) {
              // 检查房间是否存在
              const roomInfo = await redisSession.getRoomInfo(roomId);
              
              if (roomInfo) {
                debugLog(`重连用户重新加入房间`, { roomId, sessionId });
                
                // 添加用户到房间
                await redisSession.addUserToRoom(roomId, sessionId, socket.id);
                
                // 更新房间活动时间
                await redisSession.updateRoomActivity(roomId);
                
                // 更新本地缓存
                if (!localRooms[roomId]) {
                  localRooms[roomId] = {
                    users: new Map(),
                    initiator: null,
                    lastActivity: Date.now()
                  };
                }
                
                localRooms[roomId].users.set(sessionId, socket.id);
                userSessions[socket.id] = { roomId, sessionId };
                
                // 加入Socket.io房间
                socket.join(roomId);
                socket.roomId = roomId;
                
                // 获取发起方
                const initiator = await redisSession.getRoomInitiator(roomId);
                
                // 获取房间用户
                const roomUsers = await redisSession.getRoomUsers(roomId);
                
                // 通知用户房间状态
                socket.emit('room-status', {
                  shouldInitiate: initiator === sessionId,
                  usersCount: Object.keys(roomUsers).length,
                  allSessions: Object.keys(roomUsers),
                  reconnected: true
                });
              } else {
                debugLog(`尝试加入不存在的房间`, { roomId });
                socket.emit('error', { message: '房间不存在' });
              }
            }
          }
        });

        // 新增: 高级会话检查和恢复
        socket.on('advanced-session-check', async (data) => {
          const { sessionId, previousSockets = [] } = data || {};
          
          if (!sessionId || !redisSession) {
            socket.emit('advanced-session-status', { 
              success: false, 
              message: 'Missing session ID or Redis unavailable' 
            });
            return;
          }
          
          try {
            // 获取会话的各种信息
            const currentSocketId = await redisSession.getSocketIdBySessionId(sessionId);
            const backupSockets = await redisSession.getSessionBackupSockets(sessionId);
            const backupInfo = await redisSession.getSessionBackupInfo(sessionId);
            const sessionError = await redisSession.getSessionError(sessionId);
            
            // 创建状态报告
            const statusReport = {
              success: true,
              currentSocketId,
              socketId: socket.id,
              hasCurrentMapping: !!currentSocketId,
              backupSocketCount: backupSockets.length,
              hasBackupInfo: !!backupInfo,
              hasError: !!sessionError,
              timestamp: Date.now()
            };
            
            // 检查提供的之前的sockets是否还有效
            if (previousSockets.length > 0) {
              const validSockets = [];
              for (const oldSocketId of previousSockets) {
                // 验证此socketId是否仍与此会话关联
                const oldSessionId = await redisSession.getSessionIdBySocketId(oldSocketId);
                if (oldSessionId === sessionId) {
                  validSockets.push(oldSocketId);
                }
              }
              statusReport.validPreviousSockets = validSockets;
            }
            
            // 如果当前映射不存在，但有可能恢复的socket
            if (!currentSocketId && backupSockets.length > 0) {
              // 找到最近的有效备份
              const recoveryCandidate = backupSockets[0]; // 简单起见取第一个
              statusReport.recoveryCandidate = recoveryCandidate;
              statusReport.recoveryRecommended = true;
            }
            
            // 如果有错误记录，提供错误信息
            if (sessionError) {
              statusReport.errorDetails = sessionError;
            }
            
            // 发送状态报告给客户端
            socket.emit('advanced-session-status', statusReport);
            
            // 同时更新会话映射
            await redisSession.storeSocketSession(socket.id, sessionId);
            
            // 记录诊断信息
            if (!currentSocketId || currentSocketId !== socket.id) {
              debugLog(`会话映射更新：${sessionId}`, { 
                oldSocketId: currentSocketId || 'none', 
                newSocketId: socket.id 
              });
            }
          } catch (err) {
            debugLog('高级会话检查失败', { error: err.message });
            socket.emit('advanced-session-status', { 
              success: false, 
              error: err.message 
            });
          }
        });
      });

      res.socket.server.io = io;
    } catch (initError) {
      debugLog('初始化Socket.io服务器失败', { error: initError.message, stack: initError.stack });
      res.status(500).end('Internal Server Error');
      return;
    }
  } else {
    debugLog('复用现有Socket.io实例');
  }
  
  res.end('Socket.IO is running');
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
