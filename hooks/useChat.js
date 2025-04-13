import { useState, useEffect, useRef } from 'react';

export function useChat({ peer, chatChannel }) {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimerRef = useRef(null);
  
  // 监听聊天数据通道
  useEffect(() => {
    if (!chatChannel) return;
    
    // 清除可能存在的重连定时器
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    const handleOpen = () => {
      console.log('聊天通道已打开');
      setIsConnected(true);
    };
    
    const handleClose = () => {
      console.log('聊天通道已关闭');
      setIsConnected(false);
      
      // 设置定时器检查通道状态
      if (!reconnectTimerRef.current && peer) {
        reconnectTimerRef.current = setInterval(() => {
          if (peer && peer._pc && peer._pc.connectionState === 'connected') {
            console.log('尝试重新建立聊天通道');
            // 如果主连接还存在，可以在这里添加逻辑尝试重新建立通道
          }
        }, 5000);
      }
    };
    
    const handleError = (err) => {
      console.error('聊天通道错误:', err);
      setIsConnected(false);
    };
    
    const handleMessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'chat') {
          addMessage(message.content, false);
        }
      } catch (error) {
        console.error('处理聊天消息时出错:', error);
      }
    };
    
    // 立即检查当前状态
    if (chatChannel.readyState === 'open') {
      setIsConnected(true);
    }
    
    // 设置事件监听器
    chatChannel.onopen = handleOpen;
    chatChannel.onclose = handleClose;
    chatChannel.onerror = handleError;
    chatChannel.onmessage = handleMessage;
    
    // 清理函数
    return () => {
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
      }
      
      if (chatChannel) {
        chatChannel.onmessage = null;
        chatChannel.onopen = null;
        chatChannel.onclose = null;
        chatChannel.onerror = null;
      }
    };
  }, [chatChannel, peer]);

  // 添加消息到列表
  const addMessage = (content, isSelf) => {
    const newMessage = {
      id: Date.now(),
      content,
      isSelf,
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, newMessage]);
  };

  // 发送消息 - 添加错误处理和重试
  const sendMessage = (content) => {
    if (!content.trim() || !chatChannel || !isConnected) {
      return false;
    }
    
    try {
      // 准备发送的消息对象
      const messageObj = {
        type: 'chat',
        content: content.trim(),
        id: Date.now() // 添加唯一ID以支持未来可能的消息确认
      };
      
      // 发送消息到对方
      chatChannel.send(JSON.stringify(messageObj));
      
      // 添加到自己的消息列表
      addMessage(content.trim(), true);
      return true;
    } catch (error) {
      console.error('发送消息失败:', error);
      return false;
    }
  };

  return {
    messages,
    isConnected,
    sendMessage,
    addMessage
  };
}
