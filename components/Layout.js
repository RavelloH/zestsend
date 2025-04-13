import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import ThemeToggle from './ThemeToggle';
import Link from 'next/link';

export default function Layout({ children }) {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // 在客户端渲染后才显示主题切换按钮
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-4 px-4 border-b border-gray-100 dark:border-dark-border">
        <div className="container mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center">
            <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">ZestSend</span>
          </Link>
          
          <div className="flex items-center gap-4">
            {mounted && (
              <ThemeToggle 
                theme={theme} 
                setTheme={setTheme}
              />
            )}
            
            <a 
              href="https://github.com/ravelloh/zestsend" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-github">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
            </a>
          </div>
        </div>
      </header>
      
      <main className="flex-grow">
        {children}
      </main>
      
      <footer className="py-6 px-4 border-t border-gray-100 dark:border-dark-border">
        <div className="container mx-auto text-center text-sm text-gray-500 dark:text-gray-400">
          <p>ZestSend - 安全、快速的P2P文件传输</p>
          <p className="mt-1">
            <a 
              href="https://github.com/ravelloh/zestsend" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            >
              开源项目
            </a>
            {' | '}
            <a 
              href="https://github.com/ravelloh" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            >
              作者: RavelloH
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
