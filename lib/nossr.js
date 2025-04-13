/**
 * 创建一个helper确保代码只在客户端执行
 */
export const isServer = () => typeof window === 'undefined';

/**
 * 检测是否运行在服务器端
 * 如果是服务器端，则返回一个空组件
 */
export const withClientSideOnly = (Component) => {
  // 返回一个新组件，该组件只在客户端渲染
  return function ClientSideComponent(props) {
    // 使用useState和useEffect来确保仅在客户端渲染
    const [isClient, setIsClient] = useState(false);
    
    useEffect(() => {
      setIsClient(true);
    }, []);
    
    // 如果不是客户端，则返回占位符
    if (!isClient) {
      return <div className="loading-placeholder">Loading map...</div>;
    }
    
    // 如果是客户端，则正常渲染组件
    return <Component {...props} />;
  };
};

export default {
  isServer,
  withClientSideOnly
};
