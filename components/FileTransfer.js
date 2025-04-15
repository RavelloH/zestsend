import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUpload, FiFile, FiDownload, FiCheck, FiX, FiLoader, FiClock, FiTrendingUp } from 'react-icons/fi';

export default function FileTransfer({ onSendFile, receivedFiles = [] }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState({});
  const [fileProgress, setFileProgress] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [inProgress, setInProgress] = useState(false);
  // 新增: 添加传输速度和剩余时间的状态
  const [transferSpeeds, setTransferSpeeds] = useState({});
  const [remainingTimes, setRemainingTimes] = useState({});
  
  const fileInputRef = useRef(null);
  const sendQueueRef = useRef([]);
  const currentlySendingRef = useRef(false);
  // 新增: 记录上次进度更新时间和大小的引用
  const lastProgressUpdateRef = useRef({});
  // 新增: 添加稳定化计算的引用
  const stableTimeValuesRef = useRef({});
  const updateDebounceTimersRef = useRef({});
  const hasSetInitialTimeRef = useRef({});

  // 修改: 更积极地显示时间的函数，减少"估计中..."的显示
  const formatTime = (seconds, isCompleted = false, progress = 0, fileId = null, type = 'unknown') => {
    // 如果是完成状态且有有效总用时
    if (isCompleted && typeof seconds === 'number' && !isNaN(seconds) && isFinite(seconds)) {
      return `总用时 ${formatTimeDuration(seconds)}`;
    }
    
    // 如果没有有效的时间值，但有进度和fileId，则主动计算估计时间
    if ((!seconds || seconds === Infinity || isNaN(seconds)) && progress > 0 && fileId) {
      // 基于传输速率和进度计算估计时间
      const estimatedTime = estimateRemainingTime(fileId, progress, type);
      if (estimatedTime && estimatedTime > 0) {
        return formatTimeDuration(estimatedTime);
      }
      
      // 只有在真的无法估计时才显示"估计中..."
      if (progress > 15) { // 进度大于15%时，使用"预计很快完成"
        return "即将完成...";
      }
    }
    
    // 如果有有效的时间值，直接显示
    if (typeof seconds === 'number' && !isNaN(seconds) && isFinite(seconds) && seconds > 0) {
      return formatTimeDuration(seconds);
    }
    
    // 所有方法都失败时，显示"计算中..."
    return '计算中...';
  };
  
  // 新增: 根据传输历史估算剩余时间
  const estimateRemainingTime = (fileId, progress, type) => {
    if (!lastProgressUpdateRef.current[fileId]) return null;
    
    const history = lastProgressUpdateRef.current[fileId];
    const now = Date.now();
    const elapsedTime = (now - history.startTime) / 1000; // 已经过的秒数
    
    // 如果存在传输速度信息，使用速度来估算
    const speed = type.includes('send') ? transferSpeeds[fileId] : transferSpeeds[fileId];
    if (typeof speed === 'number' && speed > 0) {
      // 查找对应文件的大小
      let fileSize = 0;
      if (type.includes('send')) {
        const file = selectedFiles.find(f => f.id === fileId);
        if (file && file.file) fileSize = file.file.size;
      } else {
        const file = receivedFiles.find(f => f.id === fileId);
        if (file) fileSize = file.size || 0;
      }
      
      if (fileSize > 0 && progress > 0) {
        // 已传输的字节数
        const bytesTransferred = (progress / 100) * fileSize;
        // 剩余字节数
        const bytesRemaining = fileSize - bytesTransferred;
        // 根据当前速度估算剩余时间(秒)
        return bytesRemaining / speed;
      }
    }
    
    // 根据进度历史估算
    if (history.progressHistory && history.progressHistory.length >= 2) {
      // 获取最近两次进度更新
      const lastTwo = history.progressHistory.slice(-2);
      const progressDiff = lastTwo[1].progress - lastTwo[0].progress;
      const timeDiff = (lastTwo[1].time - lastTwo[0].time) / 1000; // 转为秒
      
      if (progressDiff > 0 && timeDiff > 0) {
        // 计算每1%进度需要的时间
        const timePerPercent = timeDiff / progressDiff;
        // 剩余进度
        const remainingProgress = 100 - progress;
        // 估算剩余时间
        return timePerPercent * remainingProgress;
      }
    }
    
    // 如果没有足够的历史数据，使用更简单的估算
    if (progress > 0 && elapsedTime > 0) {
      // 每1%进度所需的时间
      const timePerPercent = elapsedTime / progress;
      // 剩余进度
      const remainingProgress = 100 - progress;
      // 估算剩余时间
      return timePerPercent * remainingProgress;
    }
    
    // 无法估算
    return null;
  };

  // 修改: 格式化时间的辅助函数，增加错误处理
  const formatTimeDuration = (seconds) => {
    if (typeof seconds !== 'number' || isNaN(seconds) || !isFinite(seconds)) {
      return '计算中...';
    }
    
    // 确保秒数为正数
    seconds = Math.max(0, seconds);
    
    if (seconds < 60) return `${Math.floor(seconds)}秒`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}分${secs}秒`;
    }
    
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${mins}分`;
  };

  // 修改: 速度格式化函数，确保返回固定长度的字符串
  const formatSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '计算中...';
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  // 增强稳定化时间值函数，更积极地显示有效时间
  const getStableTimeValue = (fileId, newValue, type = 'remaining') => {
    const key = `${fileId}-${type}`;
    
    // 如果是首次设置该文件的时间值，直接使用新值
    if (!hasSetInitialTimeRef.current[key]) {
      hasSetInitialTimeRef.current[key] = true;
      stableTimeValuesRef.current[key] = newValue;
      return newValue;
    }
    
    // 如果新值无效但有稳定值，保持使用稳定值
    if ((newValue === undefined || newValue === null || isNaN(newValue) || !isFinite(newValue)) && 
        stableTimeValuesRef.current[key] !== undefined) {
      return stableTimeValuesRef.current[key];
    }
    
    // 如果新值有效，旧值无效或未设置，直接使用新值
    if (typeof newValue === 'number' && isFinite(newValue) && newValue >= 0 &&
        (!stableTimeValuesRef.current[key] || 
         !isFinite(stableTimeValuesRef.current[key]) || 
         stableTimeValuesRef.current[key] <= 0)) {
      
      stableTimeValuesRef.current[key] = newValue;
      return newValue;
    }
    
    // 清除之前的防抖定时器
    if (updateDebounceTimersRef.current[key]) {
      clearTimeout(updateDebounceTimersRef.current[key]);
    }
    
    // 设置防抖 - 优化发送文件时的行为
    const currentValue = stableTimeValuesRef.current[key];
    
    // 针对发送文件改进判断逻辑
    if (type.includes('send')) {
      // 发送文件时更积极地接受有效值
      if (typeof newValue === 'number' && isFinite(newValue) && newValue > 0) {
        // 如果旧值无效或者变化不是太大，立即采纳新值
        if (!currentValue || !isFinite(currentValue) || currentValue <= 0 || 
            Math.abs(newValue - currentValue) / currentValue < 0.8) {
          stableTimeValuesRef.current[key] = newValue;
          return newValue;
        }
      }
    }
    
    // 通用变化检测逻辑
    const changeRatio = currentValue ? Math.abs(newValue - currentValue) / currentValue : 1;
    
    if (changeRatio > 0.5 || currentValue === undefined) {
      // 变化大，立即更新
      stableTimeValuesRef.current[key] = newValue;
      return newValue;
    } else {
      // 小变化，保持原值，同时开始防抖定时器
      // 缩短发送文件时的防抖时间
      const debounceTime = type.includes('send') ? 500 : 1000;
      
      updateDebounceTimersRef.current[key] = setTimeout(() => {
        stableTimeValuesRef.current[key] = newValue;
      }, debounceTime);
      
      return currentValue;
    }
  };

  // 修改: 监听发送文件进度更新 - 增强历史记录以便更好估算时间
  useEffect(() => {
    // 添加全局事件监听器接收进度更新
    const handleFileProgress = (event) => {
      if (event.detail && event.detail.fileId) {
        // 提取事件中的所有数据
        const { fileId, fileName, progress, speed, remainingTime, isReceiving, sentBytes, totalBytes, status } = event.detail;
        
        console.log('接收到文件进度更新:', event.detail);
        
        // 记录传输开始时间和进度历史
        if (!lastProgressUpdateRef.current[fileId]) {
          lastProgressUpdateRef.current[fileId] = { 
            time: Date.now(),
            size: 0,
            startTime: Date.now(),
            lastValidTime: null,
            progressHistory: [] // 增加进度历史跟踪
          };
        }
        
        // 更新进度历史，用于后续估算
        if (progress !== undefined) {
          const entry = { progress, time: Date.now(), speed };
          // 最多保留10个历史进度点，防止占用太多内存
          const history = lastProgressUpdateRef.current[fileId].progressHistory || [];
          if (history.length >= 10) {
            // 删除较早的历史记录，保留最新的
            history.shift();
          }
          history.push(entry);
          lastProgressUpdateRef.current[fileId].progressHistory = history;
        }
        
        // 更新进度 - 区分接收和发送，防止状态混淆
        if (isReceiving) {
          // 接收方进度更新 - 立即显示进度
          setDownloadProgress(prev => ({
            ...prev,
            [fileId]: progress || 0
          }));
          
          // 更新接收文件的速度
          if (typeof speed === 'number' && speed > 0) {
            setTransferSpeeds(prev => ({
              ...prev,
              [fileId]: speed
            }));
          }
          
          // 更新剩余时间，使用稳定值处理
          let timeValue;
          
          if (progress >= 99.9) {
            // 完成状态：计算总用时
            timeValue = (Date.now() - (lastProgressUpdateRef.current[fileId]?.startTime || Date.now())) / 1000;
          } else {
            // 进行中：使用服务器提供的剩余时间或保持当前值
            timeValue = typeof remainingTime === 'number' && !isNaN(remainingTime) && isFinite(remainingTime) 
              ? remainingTime 
              : remainingTimes[fileId];
          }
          
          // 应用稳定化函数
          const stableTime = getStableTimeValue(fileId, timeValue, 'download-remaining');
          
          setRemainingTimes(prev => ({
            ...prev,
            [fileId]: stableTime
          }));
          
        } else {
          // 发送方处理 - 优化时间估算逻辑
          setFileProgress(prev => ({
            ...prev,
            [fileId]: progress || 0
          }));
          
          // 更新速度信息
          if (typeof speed === 'number' && speed > 0) {
            setTransferSpeeds(prev => ({
              ...prev,
              [fileId]: speed
            }));
          } else if (progress > 0) {
            // 如果没有提供速度，尝试计算速度
            const history = lastProgressUpdateRef.current[fileId].progressHistory;
            if (history && history.length >= 2) {
              const lastTwo = history.slice(-2);
              const progressDiff = lastTwo[1].progress - lastTwo[0].progress;
              const timeDiff = (lastTwo[1].time - lastTwo[0].time) / 1000; // 转为秒
              
              if (progressDiff > 0 && timeDiff > 0) {
                // 找到对应的文件对象获取大小
                const fileObj = selectedFiles.find(f => f.id === fileId);
                if (fileObj && fileObj.file) {
                  const fileSize = fileObj.file.size;
                  // 计算传输速度 (字节/秒)
                  const bytesTransferred = (progressDiff / 100) * fileSize;
                  const calculatedSpeed = bytesTransferred / timeDiff;
                  
                  setTransferSpeeds(prev => ({
                    ...prev,
                    [fileId]: calculatedSpeed
                  }));
                }
              }
            }
          }
          
          // 优化时间处理：更积极地估算和显示时间
          let timeValue;
          
          if (progress >= 99.9) {
            // 完成时显示总用时
            timeValue = (Date.now() - (lastProgressUpdateRef.current[fileId]?.startTime || Date.now())) / 1000;
          } else if (typeof remainingTime === 'number' && isFinite(remainingTime) && remainingTime > 0) {
            // 有效的剩余时间直接使用
            timeValue = remainingTime;
            lastProgressUpdateRef.current[fileId].lastValidTime = remainingTime;
          } else if (lastProgressUpdateRef.current[fileId].lastValidTime) {
            // 使用最后有效时间并基于经过时间调整
            const lastValid = lastProgressUpdateRef.current[fileId].lastValidTime;
            const elapsed = (Date.now() - lastProgressUpdateRef.current[fileId].time) / 1000;
            timeValue = Math.max(1, lastValid - elapsed); 
            lastProgressUpdateRef.current[fileId].time = Date.now();
          } else {
            // 全新估算 - 即使没有有效时间，也尝试提供估计
            timeValue = estimateRemainingTime(fileId, progress, 'send');
          }
          
          // 只在值有实质变化时才更新状态，减少不必要的渲染
          if (timeValue !== remainingTimes[fileId]) {
            setRemainingTimes(prev => ({
              ...prev,
              [fileId]: timeValue
            }));
          }
        }
      }
    };

    // 监听进度事件
    window.addEventListener('file-progress', handleFileProgress);
    
    // 清理函数
    return () => {
      window.removeEventListener('file-progress', handleFileProgress);
      
      // 清理所有防抖定时器
      Object.values(updateDebounceTimersRef.current).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
    };
  }, [selectedFiles, receivedFiles, remainingTimes, transferSpeeds]); // 注意依赖项列表添加了transferSpeeds

  // 显示收到的文件状态更多信息
  useEffect(() => {
    if (receivedFiles.length > 0) {
      console.log('接收的文件更新:', receivedFiles);
    }
  }, [receivedFiles]);

  // 新增：监听连接断开事件
  useEffect(() => {
    // 处理连接断开事件
    const handleConnectionClose = () => {
      console.log('检测到连接断开事件，正在更新文件状态...');
      
      // 找出所有正在发送中的文件并将其状态设为失败
      setSelectedFiles(prev => 
        prev.map(f => 
          f.status === 'sending' ? { ...f, status: 'failed', errorMessage: '连接已断开' } : f
        )
      );
      
      // 重置发送状态
      setSending({});
      currentlySendingRef.current = false;
      setInProgress(false);
    };
    
    // 监听自定义连接断开事件
    window.addEventListener('p2p-connection-closed', handleConnectionClose);
    
    return () => {
      window.removeEventListener('p2p-connection-closed', handleConnectionClose);
    };
  }, []);

  const onDrop = useCallback(acceptedFiles => {
    // 过滤掉空文件或零字节文件
    const validFiles = acceptedFiles.filter(file => file && file.size > 0);
    
    if (validFiles.length === 0) {
      console.warn('All dropped files are empty or invalid');
      return;
    }
    
    const newFiles = validFiles.map(file => ({
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      file,
      progress: 0,
      status: 'ready',
      addedAt: Date.now()
    }));
    
    setSelectedFiles(prev => [...prev, ...newFiles]);
  }, []);

  // 配置dropzone，禁用点击行为，我们将使用自己的点击处理器
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ 
    onDrop,
    noClick: true, // 禁用点击事件，我们将使用自定义处理
  });

  // 主动触发文件选择器
  const handleClickUpload = () => {
    open(); // 打开文件选择器对话框
  };

  // 处理发送队列 - 修复连接断开问题
  const processQueue = useCallback(async () => {
    if (currentlySendingRef.current || sendQueueRef.current.length === 0) {
      return;
    }
    
    currentlySendingRef.current = true;
    setInProgress(true);
    
    // 记录当前正在发送的文件ID，便于后续错误处理
    const fileObj = sendQueueRef.current.shift();
    if (!fileObj) {
      currentlySendingRef.current = false;
      setInProgress(false);
      return;
    }
    
    // 确保ID在状态更新前被记录下来
    const fileId = fileObj.id;
    
    try {
      setSending(prev => ({ ...prev, [fileId]: true }));
      
      // 初始化进度
      setFileProgress(prev => ({
        ...prev,
        [fileId]: 0
      }));
      
      // 初始化速度和剩余时间
      setTransferSpeeds(prev => ({
        ...prev,
        [fileId]: 0
      }));
      
      setRemainingTimes(prev => ({
        ...prev,
        [fileId]: Infinity
      }));
      
      // 更新状态为发送中
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileId ? { ...f, status: 'sending', errorMessage: null } : f
        )
      );
      
      // 启动文件发送并传递ID，方便WebRTC连接回传进度
      const result = await onSendFile(fileObj.file, fileId);
      
      // 关键修复：检查发送结果，如果返回false则表示发送失败
      if (result === false) {
        console.log('文件发送失败，设置状态为失败:', fileObj.file.name);
        setSelectedFiles(prev => 
          prev.map(f => 
            f.id === fileId ? { ...f, status: 'failed', errorMessage: '未连接到对方' } : f
          )
        );
        return;
      }
      
      // 更新状态为已发送 - 只有在确认成功发送后才更新
      if (fileObj && fileObj.id) {
        setSelectedFiles(prev => {
          const updatedFiles = prev.map(f => {
            // 只有仍处于发送中状态的文件才更新为已发送
            // 这防止覆盖可能已经被连接断开事件设置为失败的状态
            if (f.id === fileId && f.status === 'sending') {
              return { ...f, status: 'sent', progress: 100, errorMessage: null };
            }
            return f;
          });
          return updatedFiles;
        });
      }
    } catch (error) {
      console.error('File sending error:', error);
      
      // 更新当前发送失败的文件状态，并添加错误信息
      setSelectedFiles(prev => 
        prev.map(f => 
          f.id === fileId ? { ...f, status: 'failed', errorMessage: error.message || '发送过程中出错' } : f
        )
      );
    } finally {
      setTimeout(() => {
        setSending(prev => {
          const newSending = {...prev};
          delete newSending[fileId]; // 确保清除特定文件的发送状态
          return newSending;
        });
        
        currentlySendingRef.current = false;
        
        // 处理队列中的下一个文件
        if (sendQueueRef.current.length > 0) {
          processQueue();
        } else {
          setInProgress(false);
        }
      }, 1000);
    }
  }, [onSendFile]);

  const handleSendFile = useCallback((fileObj) => {
    // 将文件加入发送队列
    sendQueueRef.current.push(fileObj);
    
    // 如果当前没有正在发送的文件，开始处理队列
    if (!currentlySendingRef.current) {
      processQueue();
    }
  }, [processQueue]);

  // 添加重试发送文件的函数
  const handleRetryFile = useCallback((fileObj) => {
    // 先将文件状态重置为 ready
    setSelectedFiles(prev => 
      prev.map(f => 
        f.id === fileObj.id ? { ...f, status: 'ready', progress: 0, errorMessage: null } : f
      )
    );
    
    // 清除原有进度数据
    setFileProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileObj.id];
      return newProgress;
    });
    
    // 重置时间和速度数据
    setTransferSpeeds(prev => ({
      ...prev,
      [fileObj.id]: 0
    }));
    
    setRemainingTimes(prev => ({
      ...prev,
      [fileObj.id]: Infinity
    }));
    
    // 短暂延迟后开始发送
    setTimeout(() => {
      handleSendFile(fileObj);
    }, 100);
  }, [handleSendFile]);

  const removeFile = (id) => {
    // 如果文件在队列中，从队列中移除
    sendQueueRef.current = sendQueueRef.current.filter(f => f.id !== id);
    
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
    setFileProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[id];
      return newProgress;
    });
  };

  // 修改下载文件函数，添加边缘情况检查
  const downloadFile = (file) => {
    console.log('准备下载文件:', file);
    
    if (!file.data) {
      console.error('无法下载：文件数据为空');
      alert('文件下载失败：文件数据为空或还在传输中');
      return;
    }

    if (file.size === 0) {
      console.error('无法下载：文件大小为零');
      alert('文件下载失败：文件大小为零');
      return;
    }
    
    try {
      // 检查文件数据有效性
      if (!(file.data instanceof Blob)) {
        console.error('文件数据不是Blob类型:', typeof file.data);
        
        // 尝试创建Blob
        try {
          const blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
          if (blob.size === 0) {
            throw new Error('创建的Blob为空');
          }
          file.data = blob;
        } catch (blobError) {
          console.error('转换为Blob失败:', blobError);
          alert('文件数据格式错误，无法下载');
          return;
        }
      }
      
      // 检查Blob是否为空
      if (file.data.size === 0) {
        console.error('文件Blob大小为0');
        alert('文件为空（0字节），无法下载');
        return;
      }
      
      // 创建blob URL直接触发下载，不再模拟进度条
      const url = URL.createObjectURL(file.data);
      console.log('文件Blob URL创建成功，大小:', file.data.size, '字节');
      
      // 执行下载
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // 释放URL对象
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 100);
      
      console.log('文件下载已触发:', file.name);
      
    } catch (error) {
      console.error('File download error:', error);
      alert(`文件下载失败: ${error.message}`);
    }
  };

  // 修改进度条组件，确保正确应用暗色模式
  const ProgressBar = ({ progress, className = "", status = "normal" }) => {
    // 根据状态选择颜色
    const getColorClass = () => {
      switch (status) {
        case 'error': return 'bg-red-500';
        case 'success': return 'bg-green-500'; 
        default: return 'bg-indigo-500';
      }
    };
    
    return (
      <div className={`h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ${className}`}>
        <div 
          className={`h-full ${getColorClass()} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
    );
  };

  // 获取文件状态的显示类
  const getStatusClass = (status) => {
    switch (status) {
      case 'sent': return 'text-green-500';
      case 'failed': return 'text-red-500';
      case 'sending': return 'text-indigo-500';
      default: return 'text-gray-500';
    }
  };

  // 获取文件状态的显示文本
  const getStatusText = (status) => {
    switch (status) {
      case 'sent': return '已发送';
      case 'failed': return '发送失败';
      case 'sending': return '发送中...';
      case 'ready': return '待发送';
      default: return '';
    }
  };

  // 修改渲染文件进度信息函数，更积极地显示时间
  const renderProgressInfo = (id, progress, status) => {
    const speed = transferSpeeds[id] || 0;
    const remaining = remainingTimes[id];
    const isCompleted = progress >= 100;
    
    // 根据所有可用信息确定最佳时间显示
    let timeDisplay;
    
    if (isCompleted) {
      // 完成状态
      timeDisplay = formatTime(remaining, true, progress, id, 'send');
    } else if (typeof remaining === 'number' && isFinite(remaining) && remaining > 0) {
      // 有剩余时间
      timeDisplay = formatTimeDuration(remaining);
    } else {
      // 尝试估算
      timeDisplay = formatTime(null, false, progress, id, 'send');
    }
    
    return (
      <div className="mt-1">
        <ProgressBar 
          progress={progress || 0} 
          status={status === 'failed' ? 'error' : (status === 'sent' ? 'success' : 'normal')}
        />
        
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          <div className="w-1/3 flex items-center">
            <FiTrendingUp className="mr-1 flex-shrink-0" />
            <span className="truncate">{formatSpeed(speed)}</span>
          </div>
          
          <div className="w-1/5 text-center font-medium">{Math.round(progress || 0)}%</div>
          
          <div className="w-1/3 flex items-center justify-end">
            <FiClock className="mr-1 flex-shrink-0" />
            <span className="truncate">{timeDisplay}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`drag-area border-dashed border-2 rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-700'}`}
      >
        <input {...getInputProps()} />
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="flex flex-col items-center justify-center py-4"
          onClick={handleClickUpload} // 直接触发open()方法
        >
          <FiUpload className="text-4xl mb-3 text-indigo-500" />
          <p className="mb-2 text-gray-700 dark:text-gray-300">
            {isDragActive ? '拖放文件至此处' : '点击或拖放文件至此处'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            支持任何类型的文件
          </p>
          
          {/* 添加明确的上传按钮，确保可以触发文件选择 */}
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // 阻止事件冒泡
              open();
            }}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
            data-umami-event="选择文件"
          >
            选择文件
          </button>
        </motion.div>
      </div>

      {/* 选择的文件列表 */}
      {selectedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2 flex items-center justify-between">
            <span>待发送文件</span>
            {inProgress && (
              <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-1 rounded-full flex items-center">
                <FiLoader className="animate-spin mr-1" />
                发送中...
              </span>
            )}
          </h3>
          <div className="space-y-3">
            <AnimatePresence>
              {selectedFiles.map(fileObj => (
                <motion.div
                  key={fileObj.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex flex-col"
                >
                  <div className="flex items-center mb-2">
                    <div className="text-2xl mr-3">
                      <FiFile className={fileObj.status === 'failed' ? "text-red-500" : "text-indigo-500"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileObj.file.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(fileObj.file.size)}
                      </p>
                      {fileObj.status !== 'ready' && (
                        <p className={`text-xs flex items-center mt-1 ${getStatusClass(fileObj.status)}`}>
                          {fileObj.status === 'sent' && <FiCheck className="mr-1" />}
                          {fileObj.status === 'failed' && <FiX className="mr-1" />}
                          {fileObj.status === 'sending' && <FiLoader className="mr-1 animate-spin" />}
                          {getStatusText(fileObj.status)}
                          {/* 显示失败原因 */}
                          {fileObj.status === 'failed' && fileObj.errorMessage && (
                            <span className="ml-1">
                              : {fileObj.errorMessage}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    
                    {/* 发送按钮 (只在ready状态显示) */}
                    {fileObj.status === 'ready' && (
                      <button
                        onClick={() => handleSendFile(fileObj)}
                        disabled={sending[fileObj.id] || inProgress}
                        className="ml-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                        data-umami-event="发送文件"
                      >
                        {sending[fileObj.id] ? '发送中...' : '发送'}
                      </button>
                    )}

                    {/* 重试按钮 (只在failed状态显示) */}
                    {fileObj.status === 'failed' && (
                      <button
                        onClick={() => handleRetryFile(fileObj)}
                        className="ml-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors flex items-center"
                        data-umami-event="重试发送文件"
                      >
                        <span>重试</span>
                      </button>
                    )}
                    
                    {/* 删除按钮 (不在sending状态显示) */}
                    {fileObj.status !== 'sending' && (
                      <button
                        onClick={() => removeFile(fileObj.id)}
                        className="ml-2 text-gray-500 hover:text-red-500 flex-shrink-0 p-1"
                        data-umami-event="移除文件"
                      >
                        <FiX />
                      </button>
                    )}
                  </div>
                  
                  {/* 显示进度条 - 修复为确保始终显示，包括失败状态 */}
                  {(fileObj.status === 'sending' || fileObj.status === 'failed' || fileProgress[fileObj.id] > 0) && 
                    renderProgressInfo(fileObj.id, fileObj.status === 'failed' ? (fileProgress[fileObj.id] || 100) : fileProgress[fileObj.id], fileObj.status)
                  }
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 接收的文件列表 - 修改以显示传输中的文件 */}
      {receivedFiles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-medium mb-2 flex items-center justify-between">
            <span>已接收文件</span>
            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300 px-2 py-1 rounded-full">
              {receivedFiles.length} 个文件
            </span>
          </h3>
          <div className="space-y-3">
            <AnimatePresence>
              {receivedFiles.map(file => (
                <motion.div
                  key={file.id || `file-${file.name}-${Date.now()}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex flex-col"
                >
                  <div className="flex items-center mb-2">
                    <div className="text-2xl mr-3">
                      <FiFile className={file.data ? "text-green-500" : "text-indigo-500"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(file.size || 0)}
                        {file.data && 
                         <span className="ml-2 text-green-500">
                           (数据已就绪)
                         </span>
                        }
                        {!file.data &&
                         <span className="ml-2 text-indigo-500">
                           (接收中...)
                         </span>
                        }
                      </p>
                    </div>
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={!file.data}
                      className="ml-2 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                      data-umami-event="下载文件"
                    >
                      <FiDownload size={16} className="mr-1" />
                      <span>下载</span>
                    </button>
                  </div>
                  
                  {/* 修改: 确保即使没有进度值也显示进度条(对接收中的文件) */}
                  {(file.id && (downloadProgress[file.id] !== undefined || file.status === 'receiving')) && (
                    <div className="mt-1">
                      <ProgressBar 
                        progress={downloadProgress[file.id] || 0} 
                        status={!file.data ? "normal" : "success"} 
                      />
                      
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <div className="w-1/3 flex items-center">
                          <FiTrendingUp className="mr-1 flex-shrink-0" />
                          <span className="truncate">{formatSpeed(transferSpeeds[file.id] || 0)}</span>
                        </div>
                        
                        <div className="w-1/5 text-center font-medium">
                          {Math.round(downloadProgress[file.id] || 0)}%
                        </div>
                        
                        <div className="w-1/3 flex items-center justify-end">
                          <FiClock className="mr-1 flex-shrink-0" />
                          <span className="truncate">
                            {formatTime(
                              typeof remainingTimes[file.id] === 'number' ? remainingTimes[file.id] : null,
                              downloadProgress[file.id] >= 100
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
