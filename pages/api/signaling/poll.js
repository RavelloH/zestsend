import { getRoom, getIPInfo } from '../../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  const { roomId, peerId } = req.query;

  if (!roomId || !peerId) {
    return res.status(400).json({ message: '缺少必要参数' });
  }

  try {
    // 获取房间信息
    const room = await getRoom(roomId);
    
    if (!room) {
      return res.status(404).json({ message: '房间不存在' });
    }
    
    // 查找自己的角色信息
    const selfPeer = room.peers?.find(p => p.id === peerId);
    const isSelfInitiator = selfPeer?.type === 'initiator';
    
    // 查找自己以外的其他peer
    let remotePeerId = null;
    let remotePeerType = null;
    let shouldInitiateConnection = false;
    let connectionPriority = 'normal';
    
    if (room.peers && room.peers.length > 0) {
      // 严格筛选：必须不是自己的peerId，并且必须不是同一个IP地址
      const selfIP = selfPeer?.ip;
      const otherPeers = room.peers.filter(p => 
        p.id !== peerId && 
        p.id !== undefined && 
        p.id !== null &&
        p.ip !== selfIP  // 增加IP检查，确保不是同一个用户的多个标签页
      );
      
      if (otherPeers.length > 0) {
        // 只取第一个其他对等方，支持1对1通信
        remotePeerId = otherPeers[0].id;
        remotePeerType = otherPeers[0].type;
        
        // 确保返回的对等方ID不等于请求的ID
        if (remotePeerId === peerId) {
          console.warn(`警告: 检测到潜在的自连接风险，roomId=${roomId}, peerId=${peerId}`);
          remotePeerId = null;
          remotePeerType = null;
        }
        
        // 修改连接策略：双方都可以尝试发起连接
        // 为避免同时连接冲突，可以基于Peer ID字典序决定连接优先级
        const localPeerIdSorted = peerId.localeCompare(remotePeerId);
        shouldInitiateConnection = true; // 允许双方都发起连接
        
        // 添加一个额外参数表示连接优先级，以减少竞争条件
        connectionPriority = localPeerIdSorted < 0 ? 'high' : 'normal';
      }
    }
    
    // 尝试获取远程Peer的IP信息，确保不是自己的IP
    let ipInfo = null;
    let peerIPInfo = null; // 这个将存储远程对等方的IP信息
    
    // 获取远程节点的IP信息 - 关键修复：只有当remotePeerId存在时才获取
    if (remotePeerId && selfPeer?.ip) {
      try {
        // 修复点：使用remotePeerId而不是peerId获取远程对等方的IP信息
        ipInfo = await getIPInfo(roomId, remotePeerId);
        
        // 额外验证：确保返回的IP与自己的不同
        if (ipInfo && ipInfo.ip === selfPeer.ip) {
          console.warn(`警告: 检测到IP相同的对等方，忽略IP信息. roomId=${roomId}`);
          ipInfo = null;
        }
      } catch (error) {
        console.error(`获取远程IP信息出错: ${error.message}`);
      }
    }
    
    // 修复：为清晰起见，重命名变量，这里selIPInfo表示自己的IP信息
    let selfIPInfo = null;
    
    // 获取自己的IP信息，将来可以被对方轮询到
    try {
      if (peerId) {
        selfIPInfo = await getIPInfo(roomId, peerId);
      }
    } catch (error) {
      console.error(`获取本地IP信息出错: ${error.message}`);
    }
    
    // 返回所有信息，即使某些字段为null
    return res.status(200).json({
      roomId,
      peerId,
      remotePeerId,
      remotePeerType,
      ipInfo,                  // 远程对等方IP信息
      selfIPInfo,              // 自己的IP信息 - 更清晰的命名
      timestamp: Date.now(),
      peerCount: room.peers ? room.peers.length : 0,
      shouldInitiateConnection,
      connectionPriority
    });
  } catch (error) {
    console.error('Polling error:', error);
    return res.status(500).json({ message: '服务器错误' });
  }
}
