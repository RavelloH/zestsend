import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { FiUsers } from 'react-icons/fi';
import L from 'leaflet';

// 修复Leaflet在Next.js中的图标路径问题
useEffect(() => {
  // 只在客户端运行
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  });
}, []);

// 地图视图控制组件
function MapViewController({ center, zoom }) {
  const map = useMap();
  
  useEffect(() => {
    if (center && zoom) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  
  return null;
}

// 自定义图标
const createCustomIcon = (color) => {
  return L.divIcon({
    className: 'custom-icon',
    html: `<div style="background-color: ${color}; width: 2rem; height: 2rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${color === '#4299e1' ? '👤' : '🧑‍💻'}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });
};

export default function OpenStreetMap({ ipInfo, peerIpInfo, distance }) {
  const [mapCenter, setMapCenter] = useState([0, 0]);
  const [mapZoom, setMapZoom] = useState(2);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    // 确保组件挂载在客户端
    setMapReady(true);
    
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

  if (!mapReady || !ipInfo) {
    return (
      <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
        <p className="text-gray-500 dark:text-gray-400">加载地图中...</p>
      </div>
    );
  }

  return (
    <div className="h-60 w-full relative">
      <MapContainer 
        center={mapCenter} 
        zoom={mapZoom} 
        style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <MapViewController center={mapCenter} zoom={mapZoom} />
        
        {/* 显示自己的位置 */}
        {ipInfo?.latitude && ipInfo?.longitude && (
          <Marker 
            position={[parseFloat(ipInfo.latitude), parseFloat(ipInfo.longitude)]} 
            icon={createCustomIcon('#4299e1')}
          >
            <Popup>
              <div>
                <strong>您的位置</strong>
                <p>{ipInfo.city}, {ipInfo.country_name}</p>
                <p className="text-xs text-gray-500">IP: {ipInfo.ip}</p>
              </div>
            </Popup>
          </Marker>
        )}
        
        {/* 显示对方的位置 */}
        {peerIpInfo?.latitude && peerIpInfo?.longitude && (
          <Marker 
            position={[parseFloat(peerIpInfo.latitude), parseFloat(peerIpInfo.longitude)]} 
            icon={createCustomIcon('#48bb78')}
          >
            <Popup>
              <div>
                <strong>对方位置</strong>
                <p>{peerIpInfo.city}, {peerIpInfo.country_name}</p>
                <p className="text-xs text-gray-500">IP: {peerIpInfo.ip}</p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
      
      {distance && (
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-white/80 dark:bg-gray-800/80 px-2 py-1 rounded shadow-sm backdrop-blur-sm z-[1000] text-xs text-center">
          <FiUsers className="inline mr-1" /> 连接距离约 {distance.toFixed(0)} 公里
        </div>
      )}
    </div>
  );
}
