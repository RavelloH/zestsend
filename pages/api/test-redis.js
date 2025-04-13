import Redis from 'ioredis';

export default async function handler(req, res) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  
  if (!process.env.REDIS_URL) {
    return res.status(500).json({ 
      success: false, 
      error: 'REDIS_URL 环境变量未设置' 
    });
  }
  
  const startTime = Date.now();
  const result = {
    success: false,
    redisUrl: process.env.REDIS_URL.replace(/redis:\/\/.*@/, 'redis://***:***@'),
    connectionTime: null,
    tests: {},
    error: null
  };
  
  let redis;
  try {
    console.log('测试Redis连接到:', process.env.REDIS_URL);
    
    // 创建Redis客户端
    redis = new Redis(process.env.REDIS_URL, {
      connectTimeout: 10000,
      maxRetriesPerRequest: 1
    });
    
    // 添加事件监听器
    const connectPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 10000);
      
      redis.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      redis.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    // 等待连接
    await connectPromise;
    
    result.connectionTime = Date.now() - startTime;
    
    // 运行基本测试
    // 测试1: 设置和获取值
    const testKey = `test:${Date.now()}`;
    const testValue = `value:${Date.now()}`;
    
    await redis.set(testKey, testValue, 'EX', 60);
    const retrievedValue = await redis.get(testKey);
    
    result.tests.setGet = {
      success: retrievedValue === testValue,
      value: retrievedValue
    };
    
    // 测试2: 发布/订阅
    const channel = `test-channel:${Date.now()}`;
    const pubSubTest = new Promise((resolve) => {
      const subscriber = redis.duplicate();
      
      subscriber.subscribe(channel, () => {
        subscriber.on('message', (ch, message) => {
          if (ch === channel) {
            subscriber.unsubscribe();
            subscriber.quit();
            resolve(message);
          }
        });
        
        // 发布消息
        redis.publish(channel, 'hello');
      });
      
      // 设置超时
      setTimeout(() => {
        subscriber.unsubscribe();
        subscriber.quit();
        resolve(null);
      }, 5000);
    });
    
    const pubSubResult = await pubSubTest;
    result.tests.pubSub = {
      success: pubSubResult === 'hello',
      value: pubSubResult
    };
    
    // 测试3: 延迟和吞吐量
    const pings = [];
    for (let i = 0; i < 5; i++) {
      const pingStart = Date.now();
      await redis.ping();
      pings.push(Date.now() - pingStart);
    }
    
    result.tests.ping = {
      success: true,
      avgLatency: pings.reduce((a, b) => a + b, 0) / pings.length,
      values: pings
    };
    
    result.success = true;
  } catch (error) {
    console.error('Redis测试失败:', error);
    result.success = false;
    result.error = {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  } finally {
    if (redis) {
      try {
        redis.quit();
      } catch (e) {
        console.error('关闭Redis连接时出错:', e);
      }
    }
  }
  
  res.status(result.success ? 200 : 500).json(result);
}
