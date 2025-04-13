import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// 修复Leaflet默认图标问题
function fixLeafletIcons() {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
  });
}

// 用来使用动态中心点和缩放级别的组件
function SetViewOnChange({ center, zoom }) {
  const map = useMap();
  
  useEffect(() => {
    if (center && zoom) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  
  return null;
}

// 创建自定义图标
function createIcon(color) {
  return new L.DivIcon({
    className: '',
    html: `
      <div style="
        background-color: ${color}; 
        width: 30px; 
        height: 30px; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        border-radius: 50%; 
        color: white; 
        box-shadow: 0 3px 6px rgba(0,0,0,0.3);
        font-size: 18px;
      ">
        ${color === '#3b82f6' ? '👤' : '🧑‍💻'}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

export default function LeafletMap({ center, zoom, ipInfo, peerIpInfo }) {
  // 确保在客户端修复图标问题
  useEffect(() => {
    fixLeafletIcons();
  }, []);
  
  // 确保地图属性是有效的
  const validCenter = center && !isNaN(center[0]) && !isNaN(center[1]) 
    ? center 
    : [0, 0];
  
  const validZoom = zoom && !isNaN(zoom) ? zoom : 2;
  
  return (
    <MapContainer 
      center={validCenter}
      zoom={validZoom}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      <ZoomControl position="bottomright" />
      
      <SetViewOnChange center={validCenter} zoom={validZoom} />
      
      {/* 显示自己的位置标记 */}
      {ipInfo?.latitude && ipInfo?.longitude && (
        <Marker 
          position={[parseFloat(ipInfo.latitude), parseFloat(ipInfo.longitude)]}
          icon={createIcon('#3b82f6')}
        >
          <Popup>
            <div>
              <div className="font-bold">您的位置</div>
              <div>{ipInfo.city}, {ipInfo.country_name}</div>
              <div className="text-xs text-gray-500 mt-1">IP: {ipInfo.ip}</div>
            </div>
          </Popup>
        </Marker>
      )}
      
      {/* 显示对方的位置标记 */}
      {peerIpInfo?.latitude && peerIpInfo?.longitude && (
        <Marker 
          position={[parseFloat(peerIpInfo.latitude), parseFloat(peerIpInfo.longitude)]}
          icon={createIcon('#10b981')}
        >
          <Popup>
            <div>
              <div className="font-bold">对方位置</div>
              <div>{peerIpInfo.city}, {peerIpInfo.country_name}</div>
              <div className="text-xs text-gray-500 mt-1">IP: {peerIpInfo.ip}</div>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
