import { ThemeProvider } from 'next-themes';
import { NextUIProvider } from '@nextui-org/react';
import ThemeWrapper from '../components/ThemeWrapper';
import '../styles/globals.css';
import { StrictMode } from 'react';

// 是否开启严格模式 - 开发环境可能导致某些操作重复执行
const ENABLE_STRICT_MODE = false;

export default function App({ Component, pageProps }) {
  const AppComponent = (
    <NextUIProvider>
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeWrapper>
          <Component {...pageProps} />
        </ThemeWrapper>
      </ThemeProvider>
    </NextUIProvider>
  );

  // 有条件地启用严格模式
  if (ENABLE_STRICT_MODE) {
    return <StrictMode>{AppComponent}</StrictMode>;
  }
  
  return AppComponent;
}
