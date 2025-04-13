import { ThemeProvider } from 'next-themes';
import { NextUIProvider } from '@nextui-org/react';
import ThemeWrapper from '../components/ThemeWrapper';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <NextUIProvider>
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeWrapper>
          <Component {...pageProps} />
        </ThemeWrapper>
      </ThemeProvider>
    </NextUIProvider>
  );
}
