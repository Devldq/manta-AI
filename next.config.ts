import type { NextConfig } from 'next'

// AI: Manta v2 Next.js 配置 — 服务端 Node 模块声明 + Electron 兼容
const nextConfig: NextConfig = {
  // AI: 声明服务端使用的 Node 原生模块，防止被 webpack 错误打包
  serverExternalPackages: [
    'proper-lockfile',
    'js-yaml',
    'yaml',
    'uuid',
    'fs',
    'path',
    'os',
    'child_process',
    // AI: LangChain 相关包
    '@langchain/core',
    '@langchain/openai',
    '@langchain/ollama',
    'langchain',
    'openai',
  ],
  // AI: 禁用图片优化（Electron 环境）
  images: {
    unoptimized: true,
  },
}

export default nextConfig
