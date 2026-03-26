import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // AI: 允许服务端读取本地文件系统（proper-lockfile 为 Node.js 原生模块）
  serverExternalPackages: ['proper-lockfile'],
  
  // AI: 禁用 standalone 模式，使用标准构建
  // output: 'standalone', // 移除 standalone
  
  // AI: 禁用图片优化（Electron 环境）
  images: {
    unoptimized: true,
  },
}

export default nextConfig
