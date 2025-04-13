import Redis from 'ioredis';

// Redis客户端
let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
} else {
  // 本地开发使用内存存储
  console.log('没有找到REDIS_URL，使用内存存储代替');
}

// 存储房间信息的内存对象（当Redis不可用时）
const rooms = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '只允许POST请求' });
  }

  try {
    const { roomCode } = req.body;

    if (!roomCode || roomCode.length !== 4 || isNaN(roomCode)) {
      return res.status(400).json({ message: '房间码必须是4位数字' });
    }

    let roomExists = false;
    let isFull = false;

    if (redis) {
      // 使用Redis检查房间
      const roomData = await redis.get(`room:${roomCode}`);
      if (roomData) {
        roomExists = true;
        const room = JSON.parse(roomData);
        isFull = room.creator && room.joiner;
      }
    } else {
      // 使用内存存储检查房间
      if (rooms[roomCode]) {
        roomExists = true;
        // 房间已满的条件：有创建者和加入者
        isFull = rooms[roomCode].creator && rooms[roomCode].joiner;
        
        console.log(`检查房间 ${roomCode}:`, { 
          exists: roomExists, 
          isFull, 
          creator: !!rooms[roomCode].creator,
          joiner: !!rooms[roomCode].joiner 
        });
      }
    }

    if (isFull) {
      return res.status(409).json({ message: '房间已满' });
    }

    // 返回房间状态
    return res.status(200).json({ exists: roomExists });
    
  } catch (error) {
    console.error('处理房间请求时出错:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
