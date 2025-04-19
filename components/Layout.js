import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FaSun, FaMoon, FaGithub } from 'react-icons/fa';
import { motion } from 'framer-motion';
import ThemeWrapper from './ThemeWrapper';
import Script from 'next/script'; // 导入Script组件

export default function Layout({ children }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  if (!mounted) return null;

  return (
    <ThemeWrapper>
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Head>
          <title>ZestSend - P2P文件传输</title>
          <meta name="description" content="安全、私密的P2P文件传输" />
          <link rel="icon" href="/favicon.ico" />
          
          {/* PWA 支持 */}
          <meta name="theme-color" content={theme === 'dark' ? '#111827' : '#4F46E5'} />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <meta name="apple-mobile-web-app-title" content="ZestSend" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <link rel="manifest" href="/manifest.json" />
          
          {/* 移除Umami分析跟踪代码，改为使用Script组件 */}
        </Head>

        {/* 添加Script组件加载Umami分析代码，使用策略防止重复加载 */}
        {/* 在dev模式下不执行 */}
        {process.env.NODE_ENV !== 'development' && (
          <Script
            src="https://analytics.ravelloh.top/script.js"
            data-website-id="3bf45934-11bf-43d1-81c6-c5e418b7e6f8"
            strategy="afterInteractive"
          />
        )}

        {/* 修改header以覆盖iOS状态栏区域 */}
        <header 
          className="sticky top-0 backdrop-blur-md bg-white/90 dark:bg-gray-800/90 shadow-sm border-b border-gray-200 dark:border-gray-700"
          style={{ 
            zIndex: 3000,
            paddingTop: 'env(safe-area-inset-top, 0px)', // 使用iOS安全区域变量
          }}
        >
          {/* 添加一个容器来保持原有布局，同时考虑安全区域 */}
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Link href="/" className="text-2xl font-bold flex items-center text-gray-800 dark:text-white">
                <span className="mr-2">🚀</span>
                <span>ZestSend</span>
              </Link>
            </motion.div>
            
            <div className="flex items-center space-x-4">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={toggleTheme}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
                aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
                data-umami-event={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              >
                {theme === 'dark' ? <FaSun size={20} /> : <FaMoon size={20} />}
              </motion.button>
              
              <motion.a
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                href="https://github.com/ravelloh/zestsend"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
                aria-label="GitHub 仓库"
                data-umami-event="访问GitHub仓库"
              >
                <FaGithub size={20} />
              </motion.a>
            </div>
          </div>
        </header>

        <main className="flex-grow container mx-auto px-4 py-8 text-gray-800 dark:text-gray-200">
          {children}
        </main>

        <footer className="bg-white dark:bg-gray-800 py-6 border-t border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 text-center text-gray-600 dark:text-gray-300">
            <p>© {new Date().getFullYear()} ZestSend. 安全、私密的P2P文件传输。</p>
            <p className="mt-2 text-sm">
              <a 
                href="https://github.com/ravelloh/zestsend" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
                data-umami-event="访问GitHub链接-页脚"
              >
                GitHub:RavelloH/zestsend
              </a>. Made by <a 
                href="https://ravelloh.top/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="underline hover:text-indigo-600 dark:hover:text-indigo-400"
                data-umami-event="访问开发者主页"
              >RavelloH</a>
            </p>
          </div>
        </footer>
      </div>
    </ThemeWrapper>
  );
}
