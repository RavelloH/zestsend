import '../styles/globals.css';
import { ThemeProvider } from 'next-themes';
import Layout from '../components/Layout';
import { useEffect } from 'react';

function MyApp({ Component, pageProps }) {
  // 添加全局错误处理和WebRTC调试
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 创建全局调试对象，方便在控制台检查
      window.ZestSendDebug = {
        checkWebRTC: () => {
          console.log('WebRTC支持检查:');
          console.log('RTCPeerConnection:', !!window.RTCPeerConnection);
          console.log('RTCSessionDescription:', !!window.RTCSessionDescription);
          console.log('RTCIceCandidate:', !!window.RTCIceCandidate);
          return {
            RTCPeerConnection: !!window.RTCPeerConnection,
            RTCSessionDescription: !!window.RTCSessionDescription,
            RTCIceCandidate: !!window.RTCIceCandidate
          };
        }
      };
      
      // 全局错误处理
      window.addEventListener('error', (event) => {
        console.error('全局错误:', event.error);
      });
      
      // 未捕获的Promise错误
      window.addEventListener('unhandledrejection', (event) => {
        console.error('未捕获的Promise错误:', event.reason);
      });
      
      console.log('全局错误处理器已设置');
    }
  }, []);

  return (
    <ThemeProvider attribute="class">
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </ThemeProvider>
  )
}

export default MyApp
