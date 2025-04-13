# ZestSend

ZestSend是一个基于Next.js和WebRTC的P2P文件传输网站，允许用户无需通过服务器中转即可安全地传输文件和实时聊天。

## 特性

- 🔒 端到端加密的P2P文件传输
- 💬 实时文本消息传输
- 📱 响应式设计，支持移动端
- 🌓 支持暗色/亮色模式
- 🗺️ 显示双方IP归属地和简易地图
- 🚀 文件和消息不经过服务器存储

## 技术栈

- 前端框架: Next.js
- P2P连接: WebRTC (simple-peer)
- 实时通信: Socket.IO
- UI组件: Tailwind CSS, Framer Motion
- 地图功能: OpenStreetMap静态图片API
- 部署: Vercel

## 本地开发

1. 克隆仓库

```bash
git clone https://github.com/ravelloh/zestsend.git
cd zestsend
```

2. 安装依赖

```bash
npm install
# 或
yarn install
```

3. 启动开发服务器

```bash
npm run dev
# 或
yarn dev
```

4. 浏览器访问 [http://localhost:3000](http://localhost:3000)

## 部署到Vercel

1. Fork这个仓库到你的GitHub账户
2. 在Vercel上创建新项目并链接你的仓库
3. 部署应用

## 环境变量

- `REDIS_URL` (可选): Redis连接URL，用于存储房间信息
- `NEXT_PUBLIC_SITE_URL`: 网站URL，默认使用Vercel提供的URL

## 许可证

MIT License
