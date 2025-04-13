/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ['ip-api.com'], // 允许加载IP地理位置API的图片
  },
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.VERCEL_URL || 'http://localhost:3000'
  }
}

module.exports = nextConfig
