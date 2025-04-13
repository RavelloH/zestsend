import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiPhoneOff } from 'react-icons/fi';

export default function MediaChat({ 
  connection, 
  connected,
  onMediaChange,
  localStream,
  remoteStream,
  addLog
}) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // 设置本地和远程视频流
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
    
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [localStream, remoteStream]);

  // 处理音频切换
  const toggleAudio = async () => {
    if (!connected) {
      addLog('无法开启音频：未连接到对方', 'error');
      return;
    }
    
    try {
      if (audioEnabled) {
        // 停止音频
        if (localStream) {
          localStream.getAudioTracks().forEach(track => {
            track.stop();
          });
          onMediaChange('audio', false, null);
        }
        setAudioEnabled(false);
        addLog('已停止音频通话', 'info');
      } else {
        // 开始音频
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        onMediaChange('audio', true, stream);
        setAudioEnabled(true);
        addLog('已开始音频通话', 'success');
      }
    } catch (error) {
      addLog(`音频通话错误: ${error.message}`, 'error');
    }
  };

  // 处理视频切换
  const toggleVideo = async () => {
    if (!connected) {
      addLog('无法开启视频：未连接到对方', 'error');
      return;
    }
    
    try {
      if (videoEnabled) {
        // 停止视频
        if (localStream) {
          localStream.getVideoTracks().forEach(track => {
            track.stop();
          });
          onMediaChange('video', false, null);
        }
        setVideoEnabled(false);
        addLog('已停止视频通话', 'info');
      } else {
        // 开始视频
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        onMediaChange('video', true, stream);
        setVideoEnabled(true);
        addLog('已开始视频通话', 'success');
      }
    } catch (error) {
      addLog(`视频通话错误: ${error.message}`, 'error');
    }
  };

  // 结束所有媒体通话
  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
      });
    }
    
    onMediaChange('all', false, null);
    setAudioEnabled(false);
    setVideoEnabled(false);
    addLog('已结束所有通话', 'info');
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
      <h2 className="text-lg font-medium mb-4">实时通话</h2>
      
      {/* 媒体控制按钮 */}
      <div className="flex justify-center space-x-4 mb-4">
        <button
          onClick={toggleAudio}
          disabled={!connected}
          className={`p-3 rounded-full ${
            audioEnabled 
              ? 'bg-green-500 hover:bg-green-600 text-white' 
              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
          } transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          title={audioEnabled ? "关闭麦克风" : "开启麦克风"}
        >
          {audioEnabled ? <FiMic size={20} /> : <FiMicOff size={20} />}
        </button>
        
        <button
          onClick={toggleVideo}
          disabled={!connected}
          className={`p-3 rounded-full ${
            videoEnabled 
              ? 'bg-green-500 hover:bg-green-600 text-white' 
              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
          } transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          title={videoEnabled ? "关闭摄像头" : "开启摄像头"}
        >
          {videoEnabled ? <FiVideo size={20} /> : <FiVideoOff size={20} />}
        </button>
        
        {(audioEnabled || videoEnabled) && (
          <button
            onClick={endCall}
            className="p-3 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
            title="结束通话"
          >
            <FiPhoneOff size={20} />
          </button>
        )}
      </div>
      
      {/* 视频显示区域 */}
      {(videoEnabled || remoteStream?.getVideoTracks().length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {videoEnabled && (
            <div className="relative">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-1 rounded">
                你
              </div>
            </div>
          )}
          
          {remoteStream?.getVideoTracks().length > 0 && (
            <div className="relative">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-1 rounded">
                对方
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* 音频状态显示 */}
      {!videoEnabled && (audioEnabled || remoteStream?.getAudioTracks().length > 0) && (
        <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <div className="flex items-center justify-center">
            <div className="flex space-x-8">
              {audioEnabled && (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-xl mb-2">
                    <FiMic />
                  </div>
                  <span className="text-sm">你的麦克风已开启</span>
                </div>
              )}
              
              {remoteStream?.getAudioTracks().length > 0 && (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white text-xl mb-2 relative">
                    <FiMic />
                    <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                      remoteStream.getAudioTracks()[0].enabled ? 'bg-green-400' : 'bg-red-500'
                    }`}></div>
                  </div>
                  <span className="text-sm">对方麦克风已开启</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {!connected && (
        <div className="mt-4 p-2 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 text-sm rounded-lg text-center">
          连接到对方后可使用实时通话功能
        </div>
      )}
    </div>
  );
}
