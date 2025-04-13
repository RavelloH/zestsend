import { getRoom, setRoom } from '../../../lib/redis';

// 获取客户端IP
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded 
    ? forwarded.split(',')[0] 
    : req.socket.remoteAddress || '127.0.0.1';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '只允许POST请求' });
  }

  const { roomId, peerId, isInitiator } = req.body;
  const clientIP = getClientIP(req);

  if (!roomId || !peerId) {
    return res.status(400).json({ message: '缺少必要参数' });
  }

  try {
    // 获取房间信息
    let room = await getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ message: '房间不存在' });
    }
    
    // 检查是否已经注册了相同的peerId
    const existingPeer = room.peers?.find(p => p.id === peerId);
    if (existingPeer) {
      console.log(`已存在相同的PeerId: ${peerId}, 跳过注册`);
      return res.status(200).json({
        success: true,
        peerId,
        roomId,
        ip: clientIP,
        alreadyRegistered: true
      });
    }
    
    // 添加PeerId到房间信息
    const peerType = isInitiator ? 'initiator' : 'receiver';
    const peerInfo = {
      id: peerId,
      type: peerType,
      ip: clientIP, // 存储IP地址
      joinedAt: new Date().toISOString()
    };
    
    // 更新peers数组
    if (!room.peers) {
      room.peers = [];
    }
    
    // 检查IP是否已存在，如果存在则替换而不是添加
    const existingPeerIndex = room.peers.findIndex(p => p.ip === clientIP);
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
      roomId,
      ip: clientIP
    });
  } catch (error) {
    console.error('Peer registration error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
