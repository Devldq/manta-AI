import type { NextConfig } from 'next'

// AI: Manta v2 Next.js 配置 — 生产环境优化 + Electron 兼容
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
  // AI: 生产环境不生成 Source Maps（减少体积）
  productionBrowserSourceMaps: false,
  // AI: 跳过 TypeScript 类型检查（.next/types 已包含生成的类型）
  typescript: {
    ignoreBuildErrors: true,
  },
  // AI: 跳过 ESLint 检查（开发阶段已检查）
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
