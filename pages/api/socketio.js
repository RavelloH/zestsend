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

export default function SocketHandler(req, res) {
  if (!res.socket.server.io) {
    debugLog('初始化Socket.io服务器');
    
    // 创建Redis客户端
    let pubClient;
    let subClient;
    
    if (process.env.REDIS_URL) {
      try {
        debugLog('连接到Redis适配器');
        pubClient = new Redis(process.env.REDIS_URL);
        subClient = pubClient.duplicate();
      } catch (error) {
        debugLog('Redis连接失败', { error: error.message });
      }
    }

    const io = new Server(res.socket.server, {
      path: '/api/socketio',
      addTrailingSlash: false,
      pingTimeout: 120000,         // 增加到120秒
      pingInterval: 60000,         // 60秒一次ping
      connectTimeout: 60000,       // 连接超时时间
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      transports: ['polling'],     // 仅使用HTTP轮询
      upgradeTimeout: 10000,        // WebSocket 升级超时时间
      maxHttpBufferSize: 1e8,      // 增加缓冲区大小到100MB
      allowEIO3: true,             // 允许Engine.IO 3兼容模式
      perMessageDeflate: {         // 启用压缩
        threshold: 1024            // 仅压缩大于1KB的消息
      },
      polling: {
        requestTimeout: 60000,     // 增加到60秒
        pollingDuration: 60000,    // 增加到60秒
      }
    });

    // 如果Redis客户端已连接，设置适配器
    if (pubClient && subClient) {
      io.adapter(createAdapter(pubClient, subClient));
      debugLog('Redis适配器已设置');
    }

    // 设置定期清理房间的定时器
    setInterval(() => {
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
    }, cleanupInterval);

    // 监控主服务器连接事件
    io.engine.on('connection', (socket) => {
      const transport = socket.transport.name; // websocket or polling
      debugLog(`Engine.IO 连接已建立`, { transport, id: socket.id });
    });

    // 处理 Socket.io 服务器错误
    io.engine.on('error', (err) => {
      debugLog(`Engine.IO 错误`, { error: err.message });
    });

    // 监听HTTP长轮询连接错误
    io.engine.on('connection_error', (err) => {
      debugLog(`Engine.IO 连接错误`, { error: err.message, code: err.code });
    });

    io.on('connection', (socket) => {
      debugLog(`客户端连接: ${socket.id}`, {
        transport: socket.conn.transport.name,
        remoteAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      });
      
      // 处理传输切换
      socket.conn.on('upgrade', (transport) => {
        debugLog(`客户端传输升级: ${socket.id}`, { 
          from: socket.conn.transport.name,
          to: transport.name 
        });
      });

      // 客户端加入房间
      socket.on('join-room', (roomId, sessionId) => {
        debugLog(`用户加入房间请求`, { socketId: socket.id, roomId, sessionId });
        
        // 检查会话ID格式
        if (!sessionId) {
          socket.emit('error', { message: '缺少会话ID' });
          return;
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
        
        // 检查该会话是否已在房间中
        const existingSocketId = rooms[roomId].users.get(sessionId);
        const isNewUser = !existingSocketId || existingSocketId !== socket.id;
        
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
          
          // 第一个加入的用户作为发起方 (修改为索引0)
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
        
        // 如果是新用户且房间有两个人，则通知另一个用户
        if (isNewUser && rooms[roomId].users.size === 2) {
          for (const [otherSessionId, otherSocketId] of rooms[roomId].users.entries()) {
            if (otherSessionId !== sessionId) {
              debugLog(`通知另一用户有新用户加入`, { roomId, notifySessionId: otherSessionId });
              io.to(otherSocketId).emit('user-joined', { 
                sessionId: sessionId,
                timestamp: new Date().toISOString() 
              });
            }
          }
        }
      });
      
      // WebRTC信令 - 优化转发逻辑
      socket.on('signal', ({ roomId, signal, targetSessionId }) => {
        if (!roomId || !signal) {
          debugLog('收到无效信令数据');
          return;
        }
        
        const sessionId = socket.sessionId;
        
        // 记录信号类型
        debugLog(`收到信号 [${signal.type || 'candidate'}]`, { 
          from: sessionId, 
          roomId,
          targetSessionId,
          signalContent: signal
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
      
      // 处理连接测试请求
      socket.on('connection-test', ({ roomId, targetSessionId }) => {
        debugLog(`收到连接测试请求`, { from: socket.sessionId, to: targetSessionId, roomId });
        
        if (!roomId || !rooms[roomId]) {
          socket.emit('connection-test-result', { success: false, error: '房间不存在' });
          return;
        }
        
        // 测试信令服务器连接 - 返回房间用户列表
        const users = Array.from(rooms[roomId].users.keys());
        socket.emit('connection-test-result', { 
          success: true, 
          message: '信令服务器连接正常',
          roomUsers: users,
          initiator: rooms[roomId].initiator,
          yourSessionId: socket.sessionId,
          timestamp: new Date().toISOString()
        });
      });
      
      // 共享信息
      socket.on('peer-info', ({ roomId, info }) => {
        if (!roomId || !info) {
          debugLog('收到无效对等信息');
          return;
        }
        
        debugLog(`收到对等信息`, { 
          from: socket.sessionId, 
          roomId,
          infoSummary: {
            ip: info.ip,
            city: info.city,
            country: info.country
          }
        });
        
        // 更新房间活动时间和转发给其他用户
        if (rooms[roomId]) {
          rooms[roomId].lastActivity = Date.now();
          
          // 发送给除自己外的所有人
          const sessionId = socket.sessionId;
          for (const [otherSessionId, otherSocketId] of rooms[roomId].users.entries()) {
            if (otherSessionId !== sessionId) {
              io.to(otherSocketId).emit('peer-info', info);
            }
          }
        }
      });
      
      // 断开连接处理
      socket.on('disconnect', () => {
        debugLog(`客户端断开连接`, { socketId: socket.id });
        
        // 获取会话信息
        const sessionInfo = userSessions[socket.id];
        if (!sessionInfo) {
          debugLog(`无法找到断开连接的会话信息`, { socketId: socket.id });
          return;
        }
        
        const { roomId, sessionId } = sessionInfo;
        
        // 清理会话跟踪
        delete userSessions[socket.id];
        
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

      // 添加心跳检测处理并记录传输类型
      socket.on('heartbeat', () => {
        socket.emit('heartbeat-response', { 
          timestamp: Date.now(),
          transport: socket.conn.transport.name 
        });
      });

      // 添加传输失败处理
      socket.conn.on('upgrade', (transport) => {
        debugLog(`连接传输升级`, { id: socket.id, transport: transport.name });
      });

      socket.conn.on('error', (err) => {
        debugLog(`Socket 传输错误`, { id: socket.id, error: err.message });
      });
    });

    res.socket.server.io = io;
  } else {
    debugLog('复用现有Socket.io实例');
  }
  
  // 确保不缓存响应
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'text/plain');
  res.end();
}

export const config = {
  api: {
    bodyParser: false,
  },
};
