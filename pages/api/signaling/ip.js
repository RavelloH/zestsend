import { storeIPInfo, getIPInfo } from '../../../lib/redis';

export default async function handler(req, res) {
  // 处理POST请求 - 存储IP信息
  if (req.method === 'POST') {
    const { roomId, peerId, ipInfo } = req.body;
    
    if (!roomId || !peerId) {
      console.error('存储IP信息失败: 缺少roomId或peerId', req.body);
      return res.status(400).json({ message: '缺少必要参数 roomId 或 peerId' });
    }
    
    if (!ipInfo) {
      console.error('存储IP信息失败: ipInfo为空', req.body);
      return res.status(400).json({ message: '缺少必要参数 ipInfo' });
    }
    
    try {
      console.log(`存储IP信息: roomId=${roomId}, peerId=${peerId}`, ipInfo);
      await storeIPInfo(roomId, peerId, ipInfo);
      
      // 验证存储是否成功
      const storedInfo = await getIPInfo(roomId, peerId);
      if (!storedInfo) {
        console.error('IP信息存储失败: 存储后无法检索到数据');
        return res.status(500).json({ message: 'IP信息存储失败' });
      }
      
      return res.status(200).json({ 
        success: true,
        message: 'IP信息存储成功',
        verified: true 
      });
    } catch (error) {
      console.error('Error storing IP info:', error);
      return res.status(500).json({ message: '服务器错误: ' + error.message });
    }
  }
  
  // 处理GET请求 - 获取IP信息
  else if (req.method === 'GET') {
    const { roomId, peerId } = req.query;
    
    if (!roomId || !peerId) {
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    try {
      const ipInfo = await getIPInfo(roomId, peerId);
      return res.status(200).json({ ipInfo });
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
