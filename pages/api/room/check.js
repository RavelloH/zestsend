import { roomExists } from '../../../lib/redis';
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
    
    return res.status(200).json({
      roomId,
      exists,
      message: exists ? '房间已存在' : '房间不存在, 将创建新房间'
    });
  } catch (error) {
    console.error('Room check error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
