import { useEffect, useState } from 'react';
import { FiUsers } from 'react-icons/fi';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// 通过dynamic import确保OpenStreetMap仅在客户端加载
const OSMap = dynamic(() => import('./OpenStreetMap'), {
  ssr: false,
  loading: () => (
    <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
      <p className="text-gray-500 dark:text-gray-400">加载地图中...</p>
    </div>
  ),
});

export default function IPMap({ ipInfo, peerIpInfo }) {
  const [distance, setDistance] = useState(null);
  const [error, setError] = useState(null);

  // 计算两点之间的距离（使用Haversine公式）
  useEffect(() => {
    try {
      if (ipInfo?.latitude && ipInfo?.longitude && 
          peerIpInfo?.latitude && peerIpInfo?.longitude && 
          // 关键检查：确保对方IP不等于自己的IP
          peerIpInfo.ip !== ipInfo.ip) {
        
        const lat1 = parseFloat(ipInfo.latitude);
        const lon1 = parseFloat(ipInfo.longitude);
        const lat2 = parseFloat(peerIpInfo.latitude);
        const lon2 = parseFloat(peerIpInfo.longitude);
        
        // 如果坐标完全相同，不显示距离
        if (lat1 === lat2 && lon1 === lon2) {
          setDistance(null);
          return;
        }
        
        const R = 6371; // 地球半径（公里）
        const dLat = (lat2 - lat1) * (Math.PI/180);
        const dLon = (lon2 - lon1) * (Math.PI/180);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
                Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        
        setDistance(distance);
      } else {
        setDistance(null);
      }
    } catch (err) {
      console.error('Error calculating distance:', err);
      setError(err.message);
      setDistance(null);
    }
  }, [ipInfo, peerIpInfo]);

  const handleMapError = (err) => {
    console.error('Map error:', err);
    setError(err.message);
  };

  // 检查是否应该显示对方的位置
  const shouldShowPeerLocation = 
    peerIpInfo && 
    ipInfo && 
    peerIpInfo.ip !== ipInfo.ip && // 确保不是同一个IP
    peerIpInfo.latitude && 
    peerIpInfo.longitude;

  // 只传递有效的对方IP信息给地图组件
  const validPeerIpInfo = shouldShowPeerLocation ? peerIpInfo : null;

  return (
    <div>
      {error ? (
        <div className="h-60 w-full flex items-center justify-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-500 dark:text-red-400 text-center px-4">
            地图加载错误: {error}
          </p>
        </div>
      ) : (
        <OSMap 
          ipInfo={ipInfo} 
          peerIpInfo={validPeerIpInfo}  // 只传递有效的对方IP信息
          distance={distance} 
          onError={handleMapError}
        />
      )}
    </div>
  );
}
