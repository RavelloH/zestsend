import { roomExists, setRoom } from '../../../lib/redis';
import { isValidRoomId } from '../../../lib/utils';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  const { roomId } = req.query;

  if (!roomId || !isValidRoomId(roomId)) {
    return res.status(400).json({ message: '无效的房间ID' });
  }

  try {
    // 检查房间是否存在
    const exists = await roomExists(roomId);
    
    // 确定当前用户是创建者还是加入者
    const isInitiator = !exists;
    
    // 如果房间不存在，创建它
    if (isInitiator) {
      await setRoom(roomId, {
        createdAt: new Date().toISOString(),
        peers: []
      });
    }
    
    return res.status(200).json({
      roomId,
      isInitiator,
      message: isInitiator ? '创建了新房间' : '加入了已存在的房间'
    });
  } catch (error) {
    console.error('Room initialization error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
