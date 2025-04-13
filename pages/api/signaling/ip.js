import { storeIPInfo, getIPInfo, getRoom } from '../../../lib/redis';

export default async function handler(req, res) {
  // 处理POST请求 - 存储IP信息
  if (req.method === 'POST') {
    const { roomId, peerId, ipInfo } = req.body;
    
    if (!roomId || !peerId || !ipInfo) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    try {
      await storeIPInfo(roomId, peerId, ipInfo);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error storing IP info:', error);
      return res.status(500).json({ message: '服务器错误' });
    }
  }
  
  // 处理GET请求 - 获取IP信息
  else if (req.method === 'GET') {
    const { roomId, peerId, remotePeerId } = req.query;
    
    if (!roomId) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    try {
      let ipInfo = null;
      
      // 如果提供了特定的remotePeerId，则获取该ID的IP信息
      if (remotePeerId) {
        ipInfo = await getIPInfo(roomId, remotePeerId);
      }
      // 否则，如果提供了peerId，尝试获取房间中除了该peerId外的任何对等方的IP
      else if (peerId) {
        const room = await getRoom(roomId);
        if (room && room.peers) {
          // 查找除了请求用户外的所有peers
          const otherPeers = room.peers.filter(p => p.id !== peerId);
          
          // 如果找到了其他peers，获取第一个的IP信息
          if (otherPeers.length > 0) {
            for (const peer of otherPeers) {
              // 尝试获取每个peer的IP信息，直到找到一个有效的
              const peerIpInfo = await getIPInfo(roomId, peer.id);
              if (peerIpInfo) {
                ipInfo = peerIpInfo;
                break;
              }
            }
          }
        }
      }
      
      // 如果还是没有找到IP信息，返回一个标志
      if (!ipInfo) {
        return res.status(200).json({ 
          ipInfoAvailable: false,
          message: "未找到IP信息"
        });
      }
      
      return res.status(200).json({ 
        ipInfo,
        ipInfoAvailable: true
      });
    } catch (error) {
      console.error('Error getting IP info:', error);
      return res.status(500).json({ message: '服务器错误' });
    }
  }
  
  // 其他方法不支持
  else {
    return res.status(405).json({ message: '不支持的请求方法' });
  }
}
