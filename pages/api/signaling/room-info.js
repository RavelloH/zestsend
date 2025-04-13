import { getRoom } from '../../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  const { roomId } = req.query;

  if (!roomId) {
    return res.status(400).json({ message: '缺少房间ID' });
  }

  try {
    const room = await getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ message: '房间不存在' });
    }
    
    return res.status(200).json({ room });
  } catch (error) {
    console.error('Error getting room info:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
