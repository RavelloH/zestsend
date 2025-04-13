import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '../hooks/useChat';

export default function Chat({ peer, chatChannel }) {
  const { messages, isConnected, sendMessage } = useChat({ peer, chatChannel });
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef(null);
  
  // 添加连接状态检查和错误信息
  const [channelStatus, setChannelStatus] = useState('');
  
  // 检查聊天通道状态
  useEffect(() => {
    if (!chatChannel) {
      setChannelStatus('等待连接建立...');
      return;
    }
    
    const checkStatus = () => {
      const status = chatChannel.readyState;
      console.log('聊天通道状态:', status);
      setChannelStatus(status !== 'open' ? '聊天通道尚未准备好...' : '');
    };
    
    // 初始检查
    checkStatus();
    
    // 设置定期检查
    const interval = setInterval(checkStatus, 2000);
    
    return () => clearInterval(interval);
  }, [chatChannel]);

  // 滚动到最新消息
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 处理消息提交
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (sendMessage(inputMessage)) {
      setInputMessage('');
      setTimeout(scrollToBottom, 100);
    }
  };

  // 格式化时间
  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold mb-4">实时聊天</h2>
      
      {channelStatus && (
        <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-lg text-sm">
          {channelStatus}
        </div>
      )}
      
      <div className="flex flex-col h-96">
        {/* 消息区域 */}
        <div className="flex-grow overflow-y-auto mb-4 p-3 bg-gray-50 dark:bg-dark-card rounded-lg">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
              <p>没有消息。开始聊天吧！</p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${message.isSelf ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`max-w-[70%] px-4 py-2 rounded-lg ${
                        message.isSelf 
                          ? 'bg-primary-500 text-white rounded-br-none' 
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-none'
                      }`}
                    >
                      <p className="break-words">{message.content}</p>
                      <p className={`text-xs mt-1 ${
                        message.isSelf ? 'text-primary-100' : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {formatTime(message.timestamp)}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        
        {/* 输入区域 */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="输入消息..."
            className="flex-grow input"
            disabled={!isConnected}
          />
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={!isConnected || !inputMessage.trim()}
            className="btn-primary"
          >
            发送
          </motion.button>
        </form>
      </div>
    </div>
  );
}