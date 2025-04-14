import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiSend, FiMessageCircle } from 'react-icons/fi';

export default function Chat({ onSendMessage, messages = [] }) {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim() === '') return;
    
    onSendMessage(message);
    setMessage('');
    inputRef.current.focus();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center mb-3">
        <FiMessageCircle className="text-indigo-500 mr-2" size={20} />
        <h2 className="text-lg font-medium">实时聊天</h2>
      </div>
      
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 mb-3 overflow-y-auto max-h-60">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-4">
            还没有消息，发送第一条吧！
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {messages.map((msg, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex ${msg.isSelf ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                      msg.isSelf 
                        ? 'bg-indigo-500 text-white rounded-br-none' 
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'
                    }`}
                  >
                    {msg.text}
                    <div className={`text-xs mt-1 ${msg.isSelf ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="flex">
        <input
          type="text"
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="输入消息..."
          className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="submit"
          className="px-4 py-2 bg-indigo-500 text-white rounded-r-lg flex items-center justify-center"
          disabled={message.trim() === ''}
          data-umami-event="发送消息"
        >
          <FiSend />
        </motion.button>
      </form>
    </div>
  );
}
