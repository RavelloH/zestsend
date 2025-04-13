import { useState } from 'react';
import { motion } from 'framer-motion';

export default function RoomEntry({ onSubmit, isLoading }) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!roomCode) {
      setError('请输入房间码');
      return;
    }
    
    if (roomCode.length !== 4 || !/^\d+$/.test(roomCode)) {
      setError('房间码必须是4位数字');
      return;
    }
    
    setError('');
    onSubmit(roomCode);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label htmlFor="roomCode" className="block text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">
          请输入4位数字房间码
        </label>
        <div className="flex gap-3 justify-center">
          {[0, 1, 2, 3].map((index) => (
            <input
              key={index}
              type="text"
              maxLength="1"
              value={roomCode[index] || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^\d$/.test(val)) {
                  const newCode = roomCode.split('');
                  newCode[index] = val;
                  setRoomCode(newCode.join(''));
                  
                  // 如果输入了数字且不是最后一个输入框，自动聚焦下一个
                  if (val !== '' && index < 3 && e.target.nextElementSibling) {
                    e.target.nextElementSibling.focus();
                  }
                }
              }}
              onKeyDown={(e) => {
                // 处理退格键，自动聚焦上一个输入框
                if (e.key === 'Backspace' && !roomCode[index] && index > 0) {
                  e.target.previousElementSibling.focus();
                }
              }}
              className="w-12 h-14 text-2xl text-center input"
              required
            />
          ))}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
      
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="submit"
        disabled={isLoading}
        className="w-full btn-primary py-3 text-lg mt-4 flex items-center justify-center"
      >
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            处理中...
          </>
        ) : (
          '加入房间'
        )}
      </motion.button>
      
      <div className="mt-4 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          直接输入4位数字创建或加入房间
        </p>
      </div>
    </form>
  );
}
