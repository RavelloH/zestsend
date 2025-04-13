import { useState, useEffect } from 'react';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { motion } from 'framer-motion';

export default function IPMap({ ipInfo, peerIpInfo }) {
  const [viewState, setViewState] = useState({
    latitude: 0,
    longitude: 0,
    zoom: 1
  });

  useEffect(() => {
    // 如果有两个IP地址，将视图中心设置为两者中间点
    if (ipInfo?.latitude && ipInfo?.longitude && peerIpInfo?.latitude && peerIpInfo?.longitude) {
      const midLat = (parseFloat(ipInfo.latitude) + parseFloat(peerIpInfo.latitude)) / 2;
      const midLng = (parseFloat(ipInfo.longitude) + parseFloat(peerIpInfo.longitude)) / 2;
      
      setViewState({
        latitude: midLat,
        longitude: midLng,
        zoom: 2
      });
    } 
    // 如果只有本地IP，居中显示
    else if (ipInfo?.latitude && ipInfo?.longitude) {
      setViewState({
        latitude: parseFloat(ipInfo.latitude),
        longitude: parseFloat(ipInfo.longitude),
        zoom: 3
      });
    }
  }, [ipInfo, peerIpInfo]);

  const renderMarker = (info, isPeer = false) => {
    if (!info || !info.latitude || !info.longitude) return null;
    
    return (
      <Marker 
        latitude={parseFloat(info.latitude)} 
        longitude={parseFloat(info.longitude)} 
        offsetLeft={-20} 
        offsetTop={-40}
      >
        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="relative"
        >
          <div className={`w-8 h-8 rounded-full ${isPeer ? 'bg-green-500' : 'bg-blue-500'} flex items-center justify-center`}>
            <span className="text-white text-lg">{isPeer ? '🧑‍💻' : '👤'}</span>
          </div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-md text-xs whitespace-nowrap">
            {info.city || '未知'}, {info.country_name || '未知'}
          </div>
        </motion.div>
      </Marker>
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
      <div className="h-60 w-full">
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapStyle="mapbox://styles/mapbox/streets-v11"
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "pk.eyJ1IjoicmF2ZWxsb2giLCJhIjoiY2xvenkwOHd1MDFhbzJrbzZ4bWR5NnlpMCJ9.X6bT4qCVnfA-PsBfGcS8eg"}
        >
          {renderMarker(ipInfo, false)}
          {renderMarker(peerIpInfo, true)}
        </Map>
      </div>
      
      <div className="bg-white dark:bg-gray-800 p-4">
        <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-2 sm:space-y-0">
          <div className="flex-1 p-2 rounded-md bg-blue-50 dark:bg-blue-900/30">
            <h4 className="font-medium text-sm">您的位置</h4>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {ipInfo.ip} - {ipInfo.city}, {ipInfo.region}, {ipInfo.country_name}
            </p>
          </div>
          
          {peerIpInfo && (
            <div className="flex-1 p-2 rounded-md bg-green-50 dark:bg-green-900/30">
              <h4 className="font-medium text-sm">对方位置</h4>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {peerIpInfo.ip} - {peerIpInfo.city}, {peerIpInfo.region}, {peerIpInfo.country_name}
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
