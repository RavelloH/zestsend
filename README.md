# ZestSend

ZestSend 是一个基于 WebRTC 的点对点(P2P)文件传输网站，支持安全、私密地传输文件和消息，无需通过服务器中转或存储。

## 功能特点

- 🔒 点对点(P2P)加密传输，保证数据安全与隐私
- 📁 支持传输任何类型的文件，包括照片、视频、文档等
- 💬 内置实时文本消息功能和音视频通话
- 🌐 显示连接双方的IP地址、归属地和地图定位
- 🔄 支持屏幕共享功能
- 🌙 支持暗色和亮色模式
- 📱 响应式设计，对移动端友好

## 技术栈

- Next.js - React 框架
- WebRTC/PeerJS - P2P 数据传输
- Redis - 临时存储信令数据
- Tailwind CSS - 前端样式
- Framer Motion - 动画效果
- OpenStreetMap & Leaflet - 开源地图解决方案

## 本地开发

1. 克隆仓库：

```bash
git clone https://github.com/ravelloh/zestsend.git
cd zestsend
```

2. 安装依赖：

```bash
npm install
```

3. 创建环境变量文件 `.env.local`：

```
REDIS_URL=your_redis_connection_url
```

4. 运行开发服务器：

```bash
npm run dev
```

5. 打开浏览器访问 http://localhost:3000

## 部署到 Vercel

1. Fork 本仓库到你的 GitHub 账户
2. 在 Vercel 控制台创建新项目，选择导入你的 fork 仓库
3. 配置环境变量：
   - `REDIS_URL`: Redis 连接 URL
4. 点击部署

## 使用方法

1. 访问首页，输入一个四位数字
2. 如果该四位数字未被使用，你将成为发送方
3. 告知接收方输入相同的四位数字
4. 当双方成功连接后，你们可以互相传输文件和消息，以及进行音视频通话

## 许可证

MIT

## 联系方式

如有任何问题或建议，请提交 [Issues](https://github.com/ravelloh/zestsend/issues)
