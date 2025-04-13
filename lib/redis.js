import Redis from 'ioredis';

let redis;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
} else {
  // 本地开发时使用的配置
  if (!global.redis) {
    global.redis = new Redis();
  }
  redis = global.redis;
}

// 设置房间信息，7天过期
export async function setRoom(roomId, data) {
  const expiry = 60 * 60 * 24 * 7; // 7天，以秒为单位
  await redis.set(`room:${roomId}`, JSON.stringify(data), 'EX', expiry);
}

// 获取房间信息
export async function getRoom(roomId) {
  const data = await redis.get(`room:${roomId}`);
  return data ? JSON.parse(data) : null;
}

// 检查房间是否存在
export async function roomExists(roomId) {
  return await redis.exists(`room:${roomId}`) === 1;
}

// 存储信令消息
export async function storeSignal(roomId, peerId, signal) {
  const key = `signal:${roomId}:${peerId}`;
  await redis.rpush(key, JSON.stringify(signal));
  await redis.expire(key, 60 * 60); // 1小时过期
}

// 获取并清除所有信令消息
export async function getAndClearSignals(roomId, peerId) {
  const key = `signal:${roomId}:${peerId}`;
  const signals = await redis.lrange(key, 0, -1);
  await redis.del(key);
  return signals.map(signal => JSON.parse(signal));
}

// 存储IP信息
export async function storeIPInfo(roomId, peerId, ipInfo) {
  const key = `ip:${roomId}:${peerId}`;
  await redis.set(key, JSON.stringify(ipInfo), 'EX', 60 * 60 * 24); // 1天过期
}

// 获取IP信息
export async function getIPInfo(roomId, peerId) {
  const key = `ip:${roomId}:${peerId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

// 清理指定房间
export async function cleanupRoom(roomId) {
  const keys = await redis.keys(`*:${roomId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  await redis.del(`room:${roomId}`);
}

export default redis;
