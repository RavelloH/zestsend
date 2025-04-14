import { useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { FiSend, FiArrowRight } from 'react-icons/fi';
import Layout from '../components/Layout';
import { isValidRoomId } from '../lib/utils';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!isValidRoomId(roomId)) {
      setError('请输入4位数字');
      return;
    }
    
    setLoading(true);
    
    try {
      // 检查房间是否存在
      const res = await fetch(`/api/room/check?roomId=${roomId}`);
      const data = await res.json();
      
      if (res.ok) {
        // 跳转到房间页面
        router.push(`/room/${roomId}`);
      } else {
        setError(data.message || '检查房间状态时出错');
      }
    } catch (error) {
      console.error('Error checking room:', error);
      setError('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row gap-8 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="md:w-1/2"
          >
            <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
              ZestSend
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 mb-6">
              安全、私密的P2P文件传输
            </p>
            <div className="space-y-4 text-gray-600 dark:text-gray-300">
              <p className="flex items-center">
                <span className="mr-2">🔒</span>
                <span>端到端加密，无服务器存储</span>
              </p>
              <p className="flex items-center">
                <span className="mr-2">⚡</span>
                <span>直接P2P传输，高速且稳定</span>
              </p>
              <p className="flex items-center">
                <span className="mr-2">🌐</span>
                <span>支持任何类型的文件传输</span>
              </p>
              <p className="flex items-center">
                <span className="mr-2">💬</span>
                <span>内置实时文本聊天功能</span>
              </p>
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="md:w-1/2"
          >
            <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-xl">
              <h2 className="text-2xl font-bold mb-6 text-center">
                开始使用
              </h2>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    输入4位数字码
                  </label>
                  <input
                    type="text"
                    id="roomId"
                    maxLength={4}
                    value={roomId}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, '');
                      setRoomId(value);
                      setError('');
                    }}
                    placeholder="例如：1234"
                    className="w-full px-4 py-3 text-center text-2xl tracking-widest font-mono border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                    required
                    data-umami-event="输入房间号"
                  />
                  {error && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
                  )}
                </div>
                
                <button
                  type="submit"
                  disabled={loading || !roomId}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  data-umami-event="进入传输房间"
                >
                  {loading ? (
                    <span>检查中...</span>
                  ) : (
                    <>
                      <FiArrowRight className="mr-2" />
                      <span>进入传输房间</span>
                    </>
                  )}
                </button>
              </form>
              
              <div className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
                <p>输入任意4位数字，系统将自动判断你是发送方还是接收方</p>
              </div>
            </div>
          </motion.div>
        </div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-16"
        >
          <h2 className="text-2xl font-bold mb-6 text-center">
            如何使用 ZestSend?
          </h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
              <div className="text-3xl mb-4 text-indigo-500">1</div>
              <h3 className="text-lg font-medium mb-2">发送方输入4位数字</h3>
              <p className="text-gray-600 dark:text-gray-400">
                输入你想要的4位数字，创建一个新的传输房间
              </p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
              <div className="text-3xl mb-4 text-indigo-500">2</div>
              <h3 className="text-lg font-medium mb-2">接收方输入相同数字</h3>
              <p className="text-gray-600 dark:text-gray-400">
                接收方输入相同的4位数字，自动加入传输房间
              </p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
              <div className="text-3xl mb-4 text-indigo-500">3</div>
              <h3 className="text-lg font-medium mb-2">开始P2P传输</h3>
              <p className="text-gray-600 dark:text-gray-400">
                双方连接成功后，即可开始传输文件与消息
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
