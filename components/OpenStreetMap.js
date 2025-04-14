import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiUsers } from 'react-icons/fi';
import { isServer } from '../lib/nossr';

// 动态导入时明确指定不进行SSR
const MapWithNoSSR = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
      <p className="text-gray-500 dark:text-gray-400">加载地图中...</p>
    </div>
  ),
});

export default function OpenStreetMap({ ipInfo, peerIpInfo, distance }) {
  const [mapCenter, setMapCenter] = useState([0, 0]);
  const [mapZoom, setMapZoom] = useState(2);
  const [bounds, setBounds] = useState(null); // 新增：地图边界状态
  const [isMounted, setIsMounted] = useState(false);

  // 确保只在客户端运行
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    
    // 计算地图中心和缩放级别
    if (ipInfo?.latitude && ipInfo?.longitude && peerIpInfo?.latitude && peerIpInfo?.longitude) {
      const lat1 = parseFloat(ipInfo.latitude);
      const lng1 = parseFloat(ipInfo.longitude);
      const lat2 = parseFloat(peerIpInfo.latitude);
      const lng2 = parseFloat(peerIpInfo.longitude);
      
      // 检查坐标是否相同
      if (lat1 === lat2 && lng1 === lng2) {
        // 如果坐标相同，就只聚焦一个点
        setMapCenter([lat1, lng1]);
        setMapZoom(10);
        setBounds(null); // 单点不需要边界
        return;
      }
      
      // 计算中心点
      const centerLat = (lat1 + lat2) / 2;
      const centerLng = (lng1 + lng2) / 2;
      
      // 创建一个包含两点的边界数组，让Leaflet来自动计算最佳缩放级别
      // 注意这里使用的是[[lat1, lng1], [lat2, lng2]]格式
      const newBounds = [
        [lat1, lng1],
        [lat2, lng2]
      ];
      setBounds(newBounds);
      
      // 依然设置中心点作为备份
      setMapCenter([centerLat, centerLng]);
      
      // 计算更保守的缩放级别作为备份
      // 更保守的逻辑：对于大距离更小的缩放级别
      const latDiff = Math.abs(lat1 - lat2);
      const lngDiff = Math.abs(lng1 - lng2);
      const maxDiff = Math.max(latDiff, lngDiff);
      
      let zoom = 1; // 从最小缩放级别开始 - 更保守
      if (maxDiff < 1) zoom = 10;
      else if (maxDiff < 5) zoom = 8;
      else if (maxDiff < 20) zoom = 6;
      else if (maxDiff < 40) zoom = 4;
      else if (maxDiff < 80) zoom = 3;
      else if (maxDiff < 160) zoom = 2;
      else zoom = 1; // 对于非常远的距离，使用1级缩放
      
      setMapZoom(zoom);
    } 
    // 如果只有自己的IP信息
    else if (ipInfo?.latitude && ipInfo?.longitude) {
      setMapCenter([parseFloat(ipInfo.latitude), parseFloat(ipInfo.longitude)]);
      setMapZoom(10); // 单点显示时用更高的缩放级别
      setBounds(null); // 单点不需要边界
    }
  }, [ipInfo, peerIpInfo, isMounted]);

  // 如果在服务器端，不渲染任何内容
  if (isServer() || !isMounted) {
    return (
      <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-gray-500 dark:text-gray-400">地图将在客户端加载...</p>
      </div>
    );
  }

  // 如果没有IP信息，显示加载中
  if (!ipInfo?.latitude || !ipInfo?.longitude) {
    return (
      <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-gray-500 dark:text-gray-400">等待IP信息...</p>
      </div>
    );
  }

  return (
    <div className="h-60 w-full relative rounded-lg overflow-hidden">
      <MapWithNoSSR 
        center={mapCenter} 
        zoom={mapZoom} 
        bounds={bounds} // 传递边界给地图组件
        ipInfo={ipInfo}
        peerIpInfo={peerIpInfo}
      />
      
      {distance && (
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-white/80 dark:bg-gray-800/80 px-2 py-1 rounded shadow-sm backdrop-blur-sm z-[1000] text-xs text-center">
          <FiUsers className="inline mr-1" /> 连接距离约 {distance.toFixed(0)} 公里
        </div>
      )}
    </div>
  );
}
