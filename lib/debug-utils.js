/**
 * 调试工具函数集合，用于协助排查WebRTC传输问题
 */

// 检查并打印二进制数据详情
export function inspectBinaryData(data, label = "二进制数据") {
  if (!data) {
    console.error(`${label} 为空`);
    return "空数据";
  }
  
  let result = `${label} 类型: ${data.constructor.name}`;
  
  if (data instanceof ArrayBuffer) {
    result += `, 大小: ${data.byteLength} 字节`;
    const view = new Uint8Array(data);
    result += `, 前5字节: [${Array.from(view.slice(0, 5)).join(', ')}]`;
  } else if (ArrayBuffer.isView(data)) {
    result += `, 大小: ${data.byteLength} 字节, 偏移: ${data.byteOffset}`;
    result += `, 前5字节: [${Array.from(data.slice(0, 5)).join(', ')}]`;
  } else if (data instanceof Blob) {
    result += `, 大小: ${data.size} 字节, 类型: ${data.type}`;
  } else {
    result += `, 无法检查详情: ${typeof data}`;
  }
  
  console.log(result);
  return result;
}

// 监控WebRTC连接状态
export function monitorPeerConnection(pc, label = "PeerConnection") {
  if (!pc) return;
  
  const states = ["new", "connecting", "connected", "disconnected", "failed", "closed"];
  let lastState = pc.iceConnectionState;
  
  console.log(`${label} 初始状态: ${lastState}`);
  
  pc.addEventListener('iceconnectionstatechange', () => {
    const newState = pc.iceConnectionState;
    if (newState !== lastState) {
      console.log(`${label} 状态变化: ${lastState} -> ${newState}`);
      lastState = newState;
    }
  });
  
  pc.addEventListener('icecandidateerror', (event) => {
    console.error(`${label} ICE候选错误:`, event);
  });
}

// 打印WebRTC数据通道状态
export function logDataChannelState(dc, label = "DataChannel") {
  if (!dc) return;
  
  console.log(`${label} 状态: ${dc.readyState}, 可靠性: ${dc.ordered}, 最大重传: ${dc.maxRetransmits}`);
  
  dc.addEventListener('open', () => console.log(`${label} 已打开`));
  dc.addEventListener('close', () => console.log(`${label} 已关闭`));
  dc.addEventListener('error', (e) => console.error(`${label} 错误:`, e));
}
