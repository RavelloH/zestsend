import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import RoomEntry from '../components/RoomEntry';

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialRoomCode, setInitialRoomCode] = useState('');

  // 检查URL参数中是否有房间码
  useEffect(() => {
    if (router.isReady) {
      const { room } = router.query;
      if (room && room.length === 4 && /^\d+$/.test(room)) {
        setInitialRoomCode(room);
        handleRoomJoin(room);
      }
    }
  }, [router.isReady, router.query]);

  const handleRoomJoin = async (roomCode) => {
    try {
      setIsLoading(true);
      setError('');
      
      const response = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || '加入房间失败');
      }
      
      // 将用户重定向到正确的房间路径
      router.push(`/room/${roomCode}`);
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>ZestSend - P2P文件传输</title>
      </Head>
      <main className="container mx-auto px-4 py-12 flex flex-col items-center justify-center min-h-[80vh]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-6xl font-bold mb-4 text-primary-600 dark:text-primary-400">
            ZestSend
          </h1>
          <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl">
            安全、快速的点对点文件传输，无需服务器存储，直接连接对方设备。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-md"
        >
          <div className="card p-8">
            <RoomEntry onSubmit={handleRoomJoin} isLoading={isLoading} />
            
            {error && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm"
              >
                {error}
              </motion.div>
            )}
            
            <div className="mt-8 text-sm text-gray-500 dark:text-gray-400">
              <p>输入四位数字码创建或加入传输房间。</p>
              <p className="mt-1">如果房间不存在，将自动创建一个新房间。</p>
            </div>
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl"
        >
          {[
            { title: '安全传输', desc: '点对点直接传输，文件不经过服务器，保护您的隐私。' },
            { title: '实时沟通', desc: '附带聊天功能，在传输文件的同时保持沟通。' },
            { title: '任意文件', desc: '支持传输照片、视频、文档等任意类型的文件。' }
          ].map((item, i) => (
            <div key={i} className="card p-6">
              <h3 className="text-lg font-medium text-primary-600 dark:text-primary-400 mb-2">{item.title}</h3>
              <p className="text-gray-600 dark:text-gray-300">{item.desc}</p>
            </div>
          ))}
        </motion.div>
      </main>
    </>
  )
}
