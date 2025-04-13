import axios from 'axios';

// 提供基本IP信息的备用数据
const getFallbackData = (ip) => ({
  ip: ip || '未知',
  city: '未知',
  region: '未知',
  country: '未知',
  isp: '未知',
  lat: 0,
  lon: 0
});

export default async function handler(req, res) {
  // 获取客户端IP地址
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(/, /)[0] : req.socket.remoteAddress || '127.0.0.1';
  
  // 如果是本地IP或私有IP，返回一个默认位置
  if (ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return res.status(200).json({
      ...getFallbackData(ip),
      city: '本地网络',
      country: '本地连接',
      lat: 39.9042, // 默认位置（北京）
      lon: 116.4074
    });
  }
  
  try {
    // 尝试使用ip-api.com获取地理位置信息
    const response = await axios.get(`http://ip-api.com/json/${ip}`, {
      timeout: 5000 // 5秒超时
    });
    
    if (response.data && response.data.status === 'success') {
      res.status(200).json({
        ip: ip,
        city: response.data.city || '未知',
        region: response.data.regionName || '未知',
        country: response.data.country || '未知',
        isp: response.data.isp || '未知',
        lat: response.data.lat || 0,
        lon: response.data.lon || 0
      });
    } else {
      // 尝试备用API - ipinfo.io（免费计划限制）
      try {
        const backupResponse = await axios.get(`https://ipinfo.io/${ip}/json`, {
          timeout: 5000
        });
        
        if (backupResponse.data) {
          // ipinfo.io返回的坐标是"lat,lon"格式的字符串
          const loc = backupResponse.data.loc ? backupResponse.data.loc.split(',') : [0, 0];
          
          res.status(200).json({
            ip: ip,
            city: backupResponse.data.city || '未知',
            region: backupResponse.data.region || '未知',
            country: backupResponse.data.country || '未知',
            isp: backupResponse.data.org || '未知',
            lat: parseFloat(loc[0]) || 0,
            lon: parseFloat(loc[1]) || 0
          });
        } else {
          throw new Error('备用API无法获取地理位置信息');
        }
      } catch (backupError) {
        console.error('备用地理位置API出错:', backupError);
        // 两个API都失败，返回基本信息
        res.status(200).json(getFallbackData(ip));
      }
    }
  } catch (error) {
    console.error('获取地理位置信息出错:', error);
    
    // 返回基本信息而不是错误，确保前端仍能继续工作
    res.status(200).json(getFallbackData(ip));
  }
}
