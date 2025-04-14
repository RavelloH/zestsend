import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FaSun, FaMoon, FaGithub } from 'react-icons/fa';
import { motion } from 'framer-motion';
import ThemeWrapper from './ThemeWrapper';

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
        </Head>

        <header className="sticky top-0 z-[1000] backdrop-blur-md bg-white/90 dark:bg-gray-800/90 shadow-sm border-b border-gray-200 dark:border-gray-700">
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
              >
                GitHub 开源项目
              </a>
            </p>
          </div>
        </footer>
      </div>
    </ThemeWrapper>
  );
}
