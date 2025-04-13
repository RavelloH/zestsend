import { roomExists, setRoom, getRoom } from '../../../lib/redis';
import { isValidRoomId } from '../../../lib/utils';

// 获取客户端IP，用于识别是否是同一用户
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded 
    ? forwarded.split(',')[0] 
    : req.socket.remoteAddress || '127.0.0.1';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  const { roomId } = req.query;
  // 获取用户IP作为一种身份标识
  const clientIP = getClientIP(req);

  if (!roomId || !isValidRoomId(roomId)) {
    return res.status(400).json({ message: '无效的房间ID' });
  }

  try {
    // 检查房间是否存在
    const exists = await roomExists(roomId);
    
    // 确定当前用户是创建者还是加入者
    const isInitiator = !exists;
    
    // 如果房间已存在，检查人数和IP
    if (exists) {
      const room = await getRoom(roomId);
      
      // 检查用户是否已经在房间中（考虑刷新页面情况）
      const userAlreadyInRoom = room && room.peers && room.peers.some(p => p.ip === clientIP);
      
      // 如果用户已在房间，不做限制
      if (!userAlreadyInRoom) {
        // 检查房间是否已满（超过2人且不是已在房间的人）
        if (room && room.peers && room.peers.length >= 2) {
          return res.status(403).json({
            message: '房间已满，无法加入',
            roomFull: true
          });
        }
      }
    }
    
    // 如果房间不存在，创建它
    if (isInitiator) {
      await setRoom(roomId, {
        createdAt: new Date().toISOString(),
        peers: [{
          ip: clientIP,
          joinedAt: new Date().toISOString()
        }]
      });
    } else {
      // 更新现有房间，记录用户IP
      const room = await getRoom(roomId);
      if (room) {
        // 只有当用户不在房间时才添加
        if (!room.peers.some(p => p.ip === clientIP)) {
          room.peers.push({
            ip: clientIP,
            joinedAt: new Date().toISOString()
          });
          await setRoom(roomId, room);
        }
      }
    }
    
    return res.status(200).json({
      roomId,
      isInitiator,
      userIP: clientIP,
      message: isInitiator ? '创建了新房间' : '加入了已存在的房间'
    });
  } catch (error) {
    console.error('Room initialization error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
