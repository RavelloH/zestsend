export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '只允许GET请求' });
  }

  try {
    // 获取客户端IP
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress || '127.0.0.1';
    
    // 使用备用IP API (ipinfo.io)，或在出错时使用虚拟数据
    try {
      const response = await fetch(`https://ipinfo.io/${ip}/json`);
      
      if (response.ok) {
        const ipData = await response.json();
        
        // 解析经纬度坐标
        let latitude = 0;
        let longitude = 0;
        
        if (ipData.loc) {
          const [lat, lon] = ipData.loc.split(',');
          latitude = parseFloat(lat);
          longitude = parseFloat(lon);
        }
        
        // 返回IP信息
        return res.status(200).json({
          ip: ipData.ip || ip,
          city: ipData.city || 'Unknown',
          region: ipData.region || 'Unknown',
          country_name: ipData.country || 'Unknown',
          country_code: ipData.country || 'Unknown',
          latitude: latitude,
          longitude: longitude,
          timezone: ipData.timezone || 'Unknown',
          org: ipData.org || 'Unknown'
        });
      } else {
        throw new Error('Failed to fetch IP info');
      }
    } catch (error) {
      console.error('Error fetching IP info, using fallback data:', error);
      
      // 使用虚拟数据作为回退
      return res.status(200).json({
        ip: ip,
        city: 'Beijing',
        region: 'Beijing',
        country_name: 'China',
        country_code: 'CN',
        latitude: 39.9042,
        longitude: 116.4074, 
        timezone: 'Asia/Shanghai',
        org: 'Local Network',
        _fallback: true
      });
    }
  } catch (error) {
    console.error('Error in IP handler:', error);
    
    // 返回错误信息，但包含基本IP数据保证UI不会崩溃
    return res.status(200).json({
      ip: req.socket.remoteAddress || 'Unknown',
      error: error.message,
      city: 'Unknown',
      region: 'Unknown',
      country_name: 'Unknown',
      latitude: 0,
      longitude: 0,
      _fallback: true
    });
  }
}
