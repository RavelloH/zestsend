import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function ThemeWrapper({ children }) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // 更新HTML data-theme属性，以支持NextUI的暗色模式
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [theme]);

  if (!mounted) return null;

  return (
    <div className={`${theme === 'dark' ? 'dark-mode' : 'light-mode'}`}>
      {children}
    </div>
  );
}
