import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';

// 使用一个更简单的替代方案来显示位置信息
const SimpleLocationMap = ({ localInfo, remoteInfo }) => {
  // 检查是否有有效的坐标（非零值）
  const hasValidLocalCoords = localInfo?.lat && localInfo?.lon && 
                             (localInfo.lat !== 0 || localInfo.lon !== 0);
  const hasValidRemoteCoords = remoteInfo?.lat && remoteInfo?.lon && 
                              (remoteInfo.lat !== 0 || remoteInfo.lon !== 0);
  
  if (!hasValidLocalCoords && !hasValidRemoteCoords) {
    return (
      <div className="h-40 bg-gray-100 dark:bg-dark-card rounded-lg flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">无法获取地理位置信息</p>
      </div>
    );
  }

  // 如果只有一方有有效坐标，使用该坐标作为中心点
  let centerLat, centerLon, zoom = 2;
  
  if (hasValidLocalCoords && hasValidRemoteCoords) {
    centerLat = (localInfo.lat + remoteInfo.lat) / 2;
    centerLon = (localInfo.lon + remoteInfo.lon) / 2;
  } else if (hasValidLocalCoords) {
    centerLat = localInfo.lat;
    centerLon = localInfo.lon;
    zoom = 4; // 单点时放大一些
  } else {
    centerLat = remoteInfo.lat;
    centerLon = remoteInfo.lon;
    zoom = 4; // 单点时放大一些
  }

  // 有效的坐标点
  let markers = '';
  if (hasValidLocalCoords) {
    markers += `${localInfo.lat},${localInfo.lon},blue`;
  }
  if (hasValidRemoteCoords) {
    markers += markers ? '|' : '';
    markers += `${remoteInfo.lat},${remoteInfo.lon},red`;
  }

  const mapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${centerLat},${centerLon}&zoom=${zoom}&size=600x300&markers=${markers}`;

  return (
    <div className="h-64 rounded-lg overflow-hidden border border-gray-200 dark:border-dark-border">
      <img 
        src={mapUrl} 
        alt="Connection Map" 
        className="w-full h-full object-cover"
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 600 300'%3E%3Crect fill='%23f0f0f0' width='600' height='300'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='18' fill='%23999'%3E地图加载失败%3C/text%3E%3C/svg%3E";
        }}
      />
    </div>
  );
};

export default function PeerInfo({ localInfo, remoteInfo }) {
  // 添加调试信息
  useEffect(() => {
    console.log('PeerInfo组件信息更新:', { 
      hasLocalInfo: !!localInfo, 
      hasRemoteInfo: !!remoteInfo,
      localInfoSummary: localInfo ? {
        ip: localInfo.ip,
        city: localInfo.city,
        country: localInfo.country
      } : null,
      remoteInfoSummary: remoteInfo ? {
        ip: remoteInfo.ip,
        city: remoteInfo.city,
        country: remoteInfo.country
      } : null
    });
  }, [localInfo, remoteInfo]);

  // 渲染IP信息卡片
  const renderInfoCard = (title, info) => {
    if (!info) {
      return (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-4"
        >
          <h3 className="text-lg font-medium mb-2">{title}</h3>
          <div className="p-4 bg-gray-50 dark:bg-dark-card rounded-lg text-center">
            <p className="text-gray-500 dark:text-gray-400">
              正在获取{title}...
            </p>
          </div>
        </motion.div>
      );
    }
    
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-4"
      >
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">IP地址:</span>
            <span className="font-medium">{info.ip || '未知'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">位置:</span>
            <span className="font-medium">
              {[info.city, info.region, info.country].filter(Boolean).join(', ') || '未知'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">ISP:</span>
            <span className="font-medium">{info.isp || '未知'}</span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold mb-4">连接信息</h2>
      
      <div className="space-y-4">
        {renderInfoCard('本地信息', localInfo)}
        {renderInfoCard('对方信息', remoteInfo)}
        
        {/* 简化的地图组件 */}
        {localInfo && remoteInfo ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4"
          >
            <h3 className="text-lg font-medium mb-2">位置地图</h3>
            <SimpleLocationMap localInfo={localInfo} remoteInfo={remoteInfo} />
            <div className="mt-2 flex justify-center gap-6 text-sm">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div>
                <span>本地位置</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-500 rounded-full mr-1"></div>
                <span>对方位置</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="p-4 bg-gray-50 dark:bg-dark-card rounded-lg text-center">
            <p className="text-gray-500 dark:text-gray-400">
              {!localInfo && !remoteInfo 
                ? '正在获取位置信息...' 
                : '无法显示地图，缺少位置信息'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
