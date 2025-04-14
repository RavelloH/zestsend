import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// 设置一个变量来存储Leaflet库的引用
let L;

// 修改视图组件：添加对bounds的处理
function SetViewOnChange({ center, zoom, bounds }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds) {
      // 使用bounds优先，这是自动包含所有标记点的边界
      try {
        // 为边界增加一些填充，确保点不会太靠近地图边缘
        // 创建一个Leaflet的边界对象
        const leafletBounds = L.latLngBounds(bounds);
        
        // 应用填充，确保点不会太贴近地图边缘
        // 这里的数值是经纬度差值的百分比，根据实际情况调整
        map.fitBounds(leafletBounds, {
          padding: [30, 30], // 上下左右各添加30像素的填充
          maxZoom: 10,       // 限制最大缩放级别，避免缩放过大
          animate: true      // 平滑过渡
        });
      } catch (e) {
        console.error('设置地图边界出错:', e);
        // 出错时使用备用的center和zoom
        if (center && zoom) {
          map.setView(center, zoom);
        }
      }
    } else if (center && zoom) {
      // 如果没有bounds（单点情况），则使用center和zoom
      map.setView(center, zoom);
    }
  }, [center, zoom, bounds, map]);
  
  return null;
}

// 创建自定义图标 - 仅在客户端初始化
function createIcon(color, L) {
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

export default function LeafletMap({ center, zoom, bounds, ipInfo, peerIpInfo }) {
  // 确保在客户端修复图标问题
  useEffect(() => {
    // 仅在客户端导入Leaflet
    L = require('leaflet');
    
    // 修复Leaflet默认图标问题
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
    });
  }, []);
  
  // 确保地图属性是有效的
  const validCenter = center && !isNaN(center[0]) && !isNaN(center[1]) 
    ? center 
    : [0, 0];
  
  const validZoom = zoom && !isNaN(zoom) ? zoom : 2;
  
  // 初始化时不包含markers，等L加载完后再渲染
  const [markers, setMarkers] = useState([]);
  
  useEffect(() => {
    if (!L) return;
    
    const newMarkers = [];
    
    // 添加自己的位置标记 - 添加空值检查
    if (ipInfo?.latitude && ipInfo?.longitude) {
      newMarkers.push({
        position: [parseFloat(ipInfo.latitude), parseFloat(ipInfo.longitude)],
        icon: createIcon('#3b82f6', L),
        popup: {
          title: '您的位置',
          location: `${ipInfo.city || '未知城市'}, ${ipInfo.country_name || '未知国家'}`,
          ip: ipInfo.ip || '未知IP',
          isp: ipInfo.org || '未知ISP',
          region: ipInfo.region || '未知地区',
          timezone: ipInfo.timezone || '未知时区'
        }
      });
    }
    
    // 添加对方的位置标记 - 添加空值检查
    if (peerIpInfo?.latitude && peerIpInfo?.longitude) {
      newMarkers.push({
        position: [parseFloat(peerIpInfo.latitude), parseFloat(peerIpInfo.longitude)],
        icon: createIcon('#10b981', L),
        popup: {
          title: '对方位置',
          location: `${peerIpInfo.city || '未知城市'}, ${peerIpInfo.country_name || '未知国家'}`,
          ip: peerIpInfo.ip || '未知IP',
          isp: peerIpInfo.org || '未知ISP',
          region: peerIpInfo.region || '未知地区',
          timezone: peerIpInfo.timezone || '未知时区'
        }
      });
    }
    
    setMarkers(newMarkers);
  }, [ipInfo, peerIpInfo, L]);
  
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
      
      <SetViewOnChange center={validCenter} zoom={validZoom} bounds={bounds} />
      
      {markers.map((marker, index) => (
        <Marker 
          key={index}
          position={marker.position}
          icon={marker.icon}
        >
          <Popup className="custom-popup" minWidth={200}>
            <div className="px-1 py-1">
              <div className="font-bold text-base border-b pb-1 mb-2">{marker.popup.title}</div>
              <div className="text-sm mb-1"><strong>位置:</strong> {marker.popup.location}</div>
              <div className="text-sm mb-1"><strong>IP:</strong> {marker.popup.ip}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                <div><strong>地区:</strong> {marker.popup.region}</div>
                <div><strong>ISP:</strong> {marker.popup.isp}</div>
                <div><strong>时区:</strong> {marker.popup.timezone}</div>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
