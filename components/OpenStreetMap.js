import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiUsers } from 'react-icons/fi';

// 通过dynamic import确保leaflet仅在客户端加载
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

  useEffect(() => {
    // 计算地图中心和缩放级别
    if (ipInfo?.latitude && ipInfo?.longitude && peerIpInfo?.latitude && peerIpInfo?.longitude) {
      const lat1 = parseFloat(ipInfo.latitude);
      const lng1 = parseFloat(ipInfo.longitude);
      const lat2 = parseFloat(peerIpInfo.latitude);
      const lng2 = parseFloat(peerIpInfo.longitude);
      
      // 计算中心点
      const centerLat = (lat1 + lat2) / 2;
      const centerLng = (lng1 + lng2) / 2;
      
      // 计算适当的缩放级别
      const latDiff = Math.abs(lat1 - lat2);
      const lngDiff = Math.abs(lng1 - lng2);
      const maxDiff = Math.max(latDiff, lngDiff);
      
      let zoom = 2;
      if (maxDiff < 1) zoom = 10;
      else if (maxDiff < 5) zoom = 8;
      else if (maxDiff < 20) zoom = 6;
      else if (maxDiff < 60) zoom = 4;
      else zoom = 2;
      
      setMapCenter([centerLat, centerLng]);
      setMapZoom(zoom);
    } 
    // 如果只有自己的IP信息
    else if (ipInfo?.latitude && ipInfo?.longitude) {
      setMapCenter([parseFloat(ipInfo.latitude), parseFloat(ipInfo.longitude)]);
      setMapZoom(10);
    }
  }, [ipInfo, peerIpInfo]);

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
