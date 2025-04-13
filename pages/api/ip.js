export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  try {
    // 获取客户端IP
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
    
    // 调用第三方API获取IP位置信息
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) {
      throw new Error('Failed to fetch IP info');
    }
    
    const ipData = await response.json();
    
    // 返回IP信息
    return res.status(200).json({
      ip,
      city: ipData.city || 'Unknown',
      region: ipData.region || 'Unknown',
      country_name: ipData.country_name || 'Unknown',
      country_code: ipData.country_code || 'Unknown',
      latitude: ipData.latitude || 0,
      longitude: ipData.longitude || 0,
      timezone: ipData.timezone || 'Unknown',
      org: ipData.org || 'Unknown'
    });
  } catch (error) {
    console.error('Error fetching IP info:', error);
    
    // 返回错误信息
    return res.status(500).json({
      ip: req.socket.remoteAddress || 'Unknown',
      error: error.message,
      city: 'Unknown',
      region: 'Unknown',
      country_name: 'Unknown',
      latitude: 0,
      longitude: 0
    });
  }
}
