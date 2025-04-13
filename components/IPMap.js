import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { FiMapPin, FiUsers, FiMap } from 'react-icons/fi';

// 动态导入地图，防止服务器端渲染错误
const OpenStreetMapComponent = dynamic(() => import('./OpenStreetMap'), {
  ssr: false,
  loading: () => (
    <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-t-lg">
      <div className="text-center">
        <FiMap className="mx-auto mb-2 text-3xl text-gray-400" />
        <p className="text-gray-500 dark:text-gray-400">加载地图中...</p>
      </div>
    </div>
  ),
});

export default function IPMap({ ipInfo, peerIpInfo }) {
  const [distance, setDistance] = useState(null);
  const [mapError, setMapError] = useState(false);

  // 计算两点之间的距离（使用哈弗辛公式）
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // 地球半径（千米）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const distance = R * c; // 距离（千米）
    return distance;
  };

  useEffect(() => {
    // 如果有两个IP地址，计算距离
    if (ipInfo?.latitude && ipInfo?.longitude && peerIpInfo?.latitude && peerIpInfo?.longitude) {
      try {
        const lat1 = parseFloat(ipInfo.latitude);
        const lng1 = parseFloat(ipInfo.longitude);
        const lat2 = parseFloat(peerIpInfo.latitude);
        const lng2 = parseFloat(peerIpInfo.longitude);
        
        if (!isNaN(lat1) && !isNaN(lng1) && !isNaN(lat2) && !isNaN(lng2)) {
          // 计算两点间的距离
          const calculatedDistance = calculateDistance(lat1, lng1, lat2, lng2);
          setDistance(calculatedDistance);
        } else {
          setDistance(null);
        }
      } catch (error) {
        console.error("计算距离出错:", error);
        setDistance(null);
      }
    } else {
      setDistance(null);
    }
  }, [ipInfo, peerIpInfo]);

  // 调试输出，检查IP数据
  useEffect(() => {
    console.log("本地IP信息:", ipInfo);
    console.log("对方IP信息:", peerIpInfo);
  }, [ipInfo, peerIpInfo]);

  // 添加信息加载状态显示
  const renderPeerInfoSection = () => {
    if (!peerIpInfo) {
      return (
        <div className="flex-1 p-2 rounded-md bg-gray-50 dark:bg-gray-700/30 animate-pulse">
          <h4 className="font-medium text-sm flex items-center">
            <FiMapPin className="mr-1" /> 正在获取对方位置...
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            稍等片刻，从网络获取信息中
          </p>
        </div>
      );
    }
    
    return (
      <div className="flex-1 p-2 rounded-md bg-green-50 dark:bg-green-900/30">
        <h4 className="font-medium text-sm flex items-center">
          <FiMapPin className="mr-1" /> 对方位置
        </h4>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {peerIpInfo.ip} - {peerIpInfo.city || '未知城市'}, {peerIpInfo.region || '未知地区'}, {peerIpInfo.country_name || '未知国家'}
        </p>
      </div>
    );
  };

  if (!ipInfo) {
    return (
      <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-4 h-60 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">加载IP信息中...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-lg overflow-hidden shadow-md"
    >
      {mapError ? (
        <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <div className="text-center p-4">
            <FiMap className="mx-auto mb-2 text-3xl text-gray-400" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">地图加载失败</p>
            <button 
              onClick={() => setMapError(false)} 
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              重试加载
            </button>
          </div>
        </div>
      ) : (
        <OpenStreetMapComponent 
          ipInfo={ipInfo} 
          peerIpInfo={peerIpInfo} 
          distance={distance}
          onError={() => setMapError(true)}
        />
      )}
      
      <div className="bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-2 sm:space-y-0">
          <div className="flex-1 p-2 rounded-md bg-blue-50 dark:bg-blue-900/30">
            <h4 className="font-medium text-sm flex items-center">
              <FiMapPin className="mr-1" /> 您的位置
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {ipInfo.ip} - {ipInfo.city || '未知城市'}, {ipInfo.region || '未知地区'}, {ipInfo.country_name || '未知国家'}
            </p>
          </div>
          
          {renderPeerInfoSection()}
        </div>
        
        {distance && (
          <div className="mt-3 text-center">
            <p className="text-sm font-medium flex items-center justify-center">
              <FiUsers className="mr-1" />
              连接距离: <span className="text-indigo-600 dark:text-indigo-400 ml-1">{distance.toFixed(0)} 公里</span>
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
