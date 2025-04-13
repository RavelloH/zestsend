import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

// 房间状态管理 - 简化数据结构
const rooms = {}; // 格式: { roomId: { users: Map<sessionId, socketId>, initiator: sessionId } }
const userSessions = {}; // 跟踪用户会话 - 格式: { socketId: { roomId, sessionId } }

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

  // 初始化Socket.IO服务器
  if (!res.socket.server.io) {
    try {
      debugLog('初始化Socket.io服务器');
      
      // 创建/获取Redis客户端
      const { pubClient, subClient } = await setupRedisClients();
      
      // 创建Socket.IO服务器并配置
      const io = new Server(res.socket.server, {
        path: '/api/socketio',
        connectTimeout: 45000,         // 增加连接超时
        pingTimeout: 180000,           // 增加到3分钟
        pingInterval: 60000,           // 每分钟ping一次
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
        addTrailingSlash: false,
        // 关闭自动重连以减轻服务器负担
        reconnection: false,
      });
      
      // 创建自定义会话存储
      const sessionStore = new Map();
      
      // 设置Redis适配器
      if (pubClient && subClient) {
        try {
          debugLog('设置Redis适配器');
          const redisAdapter = createAdapter(pubClient, subClient);
          io.adapter(redisAdapter);
          
          debugLog('Redis适配器已设置，测试连接');
          // 测试适配器连接
          pubClient.set('socket:test', 'connected', 'EX', 60);
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
      io.engine.on('connection_error', (err) => {
        debugLog(`Engine.IO 连接错误`, { error: err.message, code: err.code, context: err.context || 'unknown', req: err.req ? `${err.req.method} ${err.req.url}` : 'unknown' });
      });
      
      // 监听HTTP长轮询请求错误
      io.engine.on('initialHeaders', (headers, req) => {
        // 添加自定义头以缓解缓存问题
        headers['X-Socket-Session-Time'] = Date.now().toString();
      });

      // 初始化清理定时器
      if (!cleanupTimer) {
        cleanupTimer = setInterval(() => {
          // 清理过期的房间
          const now = Date.now();
          let cleaned = 0;
          
          Object.keys(rooms).forEach(roomId => {
            if (now - rooms[roomId].lastActivity > roomExpiry) {
              debugLog(`清理过期房间: ${roomId}`);
              delete rooms[roomId];
              cleaned++;
            }
          });
          
          if (cleaned > 0) {
            debugLog(`已清理 ${cleaned} 个过期房间`);
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
      io.on('connection', (socket) => {
        const transport = socket.conn.transport.name;
        debugLog(`客户端连接: ${socket.id}`, {
          transport,
          remoteAddress: socket.handshake.address,
          headers: {
            'user-agent': socket.handshake.headers['user-agent'],
            'x-forwarded-for': socket.handshake.headers['x-forwarded-for'] || 'none'
          }
        });
        
        // 存储会话ID到Redis以实现跨实例会话恢复
        socket.on('register-session', async (sessionId) => {
          if (!sessionId) {
            debugLog('客户端未提供会话ID', { socketId: socket.id });
            return;
          }
          
          debugLog(`注册会话ID: ${sessionId}`, { socketId: socket.id });
          
          // 记录到本地Map
          sessionStore.set(socket.id, sessionId);
          
          // 如果有Redis，存储会话映射
          if (pubClient) {
            try {
              await pubClient.set(`socket:${socket.id}:session`, sessionId, 'EX', 86400); // 24小时过期
              await pubClient.set(`session:${sessionId}:socket`, socket.id, 'EX', 86400);
              debugLog(`会话ID已存储到Redis: ${sessionId}`);
            } catch (err) {
              debugLog('存储会话ID到Redis失败', { error: err.message });
            }
          }
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
          
          // 存储到Redis
          if (pubClient) {
            try {
              await pubClient.set(`socket:${socket.id}:session`, sessionId, 'EX', 86400);
              await pubClient.set(`session:${sessionId}:socket`, socket.id, 'EX', 86400);
            } catch (err) {
              debugLog('存储会话数据到Redis失败', { error: err.message });
            }
          }
          
          // 初始化或获取房间
          if (!rooms[roomId]) {
            // 新房间
            rooms[roomId] = {
              users: new Map(), // 键为会话ID，值为socket ID
              initiator: null,  // 发起方会话ID
              createdAt: Date.now(),
              lastActivity: Date.now()
            };
            debugLog(`创建房间 ${roomId}`);
          }
          
          // 更新活动时间
          rooms[roomId].lastActivity = Date.now();
          
          // 检查房间容量
          if (rooms[roomId].users.size >= 2) {
            // 检查请求者是否已经在房间中
            if (!rooms[roomId].users.has(sessionId)) {
              socket.emit('room-full');
              debugLog(`拒绝用户加入，房间已满`, { roomId, sessionId });
              return;
            } else {
              debugLog(`用户重新连接到已满房间`, { roomId, sessionId });
            }
          }
          
          // 把用户添加到房间
          rooms[roomId].users.set(sessionId, socket.id);
          userSessions[socket.id] = { roomId, sessionId };
          
          // 加入Socket.io房间
          socket.join(roomId);
          
          // 存储用户的房间信息
          socket.roomId = roomId;
          socket.sessionId = sessionId;
          
          // 确定发起方 - 修改为第一个加入的用户是发起方
          if (rooms[roomId].users.size === 2 && rooms[roomId].initiator === null) {
            // 获取所有会话ID，按照加入顺序
            const allSessionIds = Array.from(rooms[roomId].users.keys());
            
            // 第一个加入的用户作为发起方
            rooms[roomId].initiator = allSessionIds[0];
            debugLog(`已确定发起方`, { roomId, initiator: allSessionIds[0] });
          }
          
          // 确定当前用户是否是发起方
          const shouldInitiate = rooms[roomId].initiator === sessionId;
          
          // 通知用户房间状态
          debugLog(`通知用户房间状态`, { socketId: socket.id, shouldInitiate, usersCount: rooms[roomId].users.size });
          socket.emit('room-status', { 
            shouldInitiate, 
            usersCount: rooms[roomId].users.size,
            allSessions: Array.from(rooms[roomId].users.keys())
          });
          
          // 通知其他人有新用户加入
          for (const [otherSessionId, otherSocketId] of rooms[roomId].users.entries()) {
            if (otherSessionId !== sessionId) {
              debugLog(`通知其他用户有新成员加入`, { roomId, notifySessionId: otherSessionId });
              io.to(otherSocketId).emit('user-joined', { 
                sessionId: sessionId,
                timestamp: new Date().toISOString() 
              });
            }
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
          
          // 检查房间是否存在
          if (!rooms[roomId]) {
            debugLog(`信号转发失败: 房间不存在`, { roomId });
            return;
          }
          
          // 更新房间活动时间
          rooms[roomId].lastActivity = Date.now();
          
          // 优先使用指定目标
          if (targetSessionId) {
            const targetSocketId = rooms[roomId].users.get(targetSessionId);
            
            // 如果内存中找不到，尝试从Redis获取
            if (!targetSocketId && pubClient) {
              try {
                const redisSocketId = await pubClient.get(`session:${targetSessionId}:socket`);
                if (redisSocketId) {
                  debugLog(`从Redis中找到目标socket ID`, { targetSessionId, redisSocketId });
                  // 更新本地缓存
                  rooms[roomId].users.set(targetSessionId, redisSocketId);
                  // 发送信号
                  io.to(redisSocketId).emit('signal', { 
                    signal, 
                    sessionId: sessionId 
                  });
                  return;
                }
              } catch (err) {
                debugLog('从Redis获取会话失败', { error: err.message });
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
          
          // 否则转发给房间中的另一个用户
          for (const [otherSessionId, otherSocketId] of rooms[roomId].users.entries()) {
            if (otherSessionId !== sessionId) {
              debugLog(`转发信号给房间内其他用户`, { to: otherSessionId });
              io.to(otherSocketId).emit('signal', { 
                signal, 
                sessionId: sessionId 
              });
              return; // 只发给一个用户就返回，因为房间限制为2人
            }
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
          
          // 清理会话跟踪
          delete userSessions[socket.id];
          sessionStore.delete(socket.id);
          
          // 从Redis删除会话信息
          if (pubClient) {
            try {
              await pubClient.del(`socket:${socket.id}:session`);
              // 不要删除 session:sessionId:socket，允许会话恢复
            } catch (err) {
              debugLog('从Redis删除会话数据失败', { error: err.message });
            }
          }
          
          if (roomId && rooms[roomId]) {
            // 检查该会话是否有新的socket连接
            const currentSocketId = rooms[roomId].users.get(sessionId);
            
            // 只有当当前socket ID与断开连接的socket ID相同时才移除
            if (currentSocketId === socket.id) {
              debugLog(`从房间移除用户会话`, { roomId, sessionId });
              rooms[roomId].users.delete(sessionId);
              
              // 如果离开的是发起方，重置发起方
              if (rooms[roomId].initiator === sessionId) {
                rooms[roomId].initiator = null;
                debugLog(`发起方离开，重置发起方`, { roomId });
              }
              
              // 通知房间中的其他人
              for (const otherSocketId of rooms[roomId].users.values()) {
                io.to(otherSocketId).emit('peer-disconnected', { sessionId });
              }
            } else {
              debugLog(`用户会话有新连接，不移除`, { sessionId, currentSocketId });
            }
            
            // 更新活动时间
            rooms[roomId].lastActivity = Date.now();
            
            // 如果房间空了，删除它
            if (rooms[roomId].users.size === 0) {
              debugLog(`房间已空，删除房间`, { roomId });
              delete rooms[roomId];
            }
          }
        });

        // 添加心跳检测处理
        socket.on('heartbeat', () => {
          socket.emit('heartbeat-response', { 
            timestamp: Date.now(),
            transport: socket.conn.transport.name,
            sessionId: socket.sessionId || sessionStore.get(socket.id) || 'unknown'
          });
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
