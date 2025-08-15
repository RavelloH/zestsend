export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 从环境变量获取 Cloudflare TURN 配置
    const TURN_ID = process.env.TURN_ID;
    const TURN_TOKEN = process.env.TURN_TOKEN;

    if (!TURN_ID || !TURN_TOKEN) {
      return res.status(500).json({ 
        error: 'TURN credentials not configured',
        message: 'TURN_ID and TURN_TOKEN must be set in environment variables'
      });
    }

    // 从请求中获取 TTL，默认为 24 小时（86400 秒）
    const { ttl = 86400 } = req.body;

    // 调用 Cloudflare API 生成临时凭据
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TURN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Cloudflare TURN API error:', error);
      return res.status(response.status).json({ 
        error: 'Failed to generate TURN credentials',
        message: error
      });
    }

    const data = await response.json();

    // 记录日志（不包含敏感信息）
    console.log('TURN credentials generated successfully', {
      username: data.iceServers?.[0]?.username?.substring(0, 8) + '...',
      urls: data.iceServers?.[0]?.urls?.length || 0,
      ttl
    });

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error generating TURN credentials:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}
