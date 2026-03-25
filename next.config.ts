import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // AI: 允许服务端读取本地文件系统（proper-lockfile 为 Node.js 原生模块）
  serverExternalPackages: ['proper-lockfile'],
}

export default nextConfig
