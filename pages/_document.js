import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* PWA meta tags */}
        <meta name='application-name' content='ZestSend' />
        <meta name='apple-mobile-web-app-capable' content='yes' />
        <meta name='apple-mobile-web-app-status-bar-style' content='black-translucent' />
        <meta name='apple-mobile-web-app-title' content='ZestSend' />
        <meta name='format-detection' content='telephone=no' />
        <meta name='mobile-web-app-capable' content='yes' />
        <meta name='msapplication-TileColor' content='#4F46E5' />
        <meta name='msapplication-tap-highlight' content='no' />
        
        {/* 添加viewport-fit=cover以确保内容可以延伸到屏幕边缘 */}
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
