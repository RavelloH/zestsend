import { getRoom, setRoom } from '../../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '只允许POST请求' });
  }

  const { roomId, peerId, isInitiator } = req.body;

  if (!roomId || !peerId) {
    return res.status(400).json({ message: '缺少必要参数' });
  }

  try {
    // 获取房间信息
    let room = await getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ message: '房间不存在' });
    }
    
    // 添加PeerId到房间信息
    const peerType = isInitiator ? 'initiator' : 'receiver';
    const peerInfo = {
      id: peerId,
      type: peerType,
      joinedAt: new Date().toISOString()
    };
    
    // 更新peers数组
    if (!room.peers) {
      room.peers = [];
    }
    
    // 检查peerId是否已存在
    const existingPeerIndex = room.peers.findIndex(p => p.id === peerId);
    if (existingPeerIndex >= 0) {
      room.peers[existingPeerIndex] = peerInfo;
    } else {
      room.peers.push(peerInfo);
    }
    
    // 更新房间信息
    await setRoom(roomId, room);
    
    return res.status(200).json({
      success: true,
      peerId,
      roomId
    });
  } catch (error) {
    console.error('Peer registration error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
