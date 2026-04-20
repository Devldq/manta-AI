#!/usr/bin/env node

/**
 * AI: 生产环境构建清理脚本
 * 在 electron-builder 打包前清理不必要的文件，减少最终应用包体积
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// AI: 配置
const ROOT_DIR = path.join(__dirname, '..');
const NEXT_DIR = path.join(ROOT_DIR, '.next');
const NODE_MODULES_DIR = path.join(ROOT_DIR, 'node_modules');

// AI: 需要清理的 .next 目录下的文件和文件夹
const NEXT_CLEANUP_TARGETS = [
  'cache',           // Webpack 缓存 (约 274M)
  'types',           // TypeScript 类型生成
  'trace',           // 构建追踪文件
  'package.json',    // 多余的 package.json
  'react-loadable-manifest.json',
  'app-build-manifest.json',
  'build-manifest.json',
  'export-marker.json',
  'prerender-manifest.json',
  'routes-manifest.json',
  'server-reference-manifest',
  'required-server-dependencies.json',
  'images-manifest.json',
];

// AI: 需要清理的 node_modules 模式
const NODE_MODULES_PATTERNS = [
  '.cache',
  '.pnpm',
  '.bin',
  '__tests__',
  '__mocks__',
  'test',
  'tests',
  'example',
  'examples',
];

// AI: 需要删除的文件扩展名
const FILE_EXTENSIONS_TO_REMOVE = [
  '.d.ts',
  '.d.cts',
  '.d.mts',
  '.map',
];

// AI: 需要删除的文档文件
const DOC_FILES_TO_REMOVE = [
  'README.md',
  'README',
  'CHANGELOG.md',
  'CHANGELOG',
  'HISTORY.md',
  'HISTORY',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'AUTHORS',
  'CONTRIBUTORS',
  'NOTICE',
];

/**
 * AI: 安全删除文件或目录
 */
function safeRemove(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      if (fs.statSync(targetPath).isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
      console.log(`✓ 已删除: ${path.relative(ROOT_DIR, targetPath)}`);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`⚠ 删除失败: ${path.relative(ROOT_DIR, targetPath)} - ${error.message}`);
    return false;
  }
}

/**
 * AI: 清理 .next 目录
 */
function cleanNextDir() {
  console.log('\n🧹 清理 .next 目录...');
  let removedCount = 0;

  for (const target of NEXT_CLEANUP_TARGETS) {
    const targetPath = path.join(NEXT_DIR, target);
    if (safeRemove(targetPath)) {
      removedCount++;
    }
  }

  console.log(`  已清理 ${removedCount} 个目标`);
}

/**
 * AI: 递归查找并删除匹配的文件
 */
function findAndRemoveFiles(dir, patterns, extensions) {
  let removedCount = 0;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // AI: 跳过符号链接，避免无限循环
        if (entry.isSymbolicLink()) continue;
        
        // AI: 检查是否应该跳过该目录
        if (patterns.includes(entry.name)) {
          if (safeRemove(fullPath)) {
            removedCount++;
          }
          continue;
        }
        
        // AI: 递归处理子目录
        removedCount += findAndRemoveFiles(fullPath, patterns, extensions);
      } else if (entry.isFile()) {
        // AI: 检查文件扩展名
        if (extensions.some(ext => entry.name.endsWith(ext))) {
          if (safeRemove(fullPath)) {
            removedCount++;
          }
        }
        // AI: 检查文档文件名
        else if (DOC_FILES_TO_REMOVE.includes(entry.name)) {
          if (safeRemove(fullPath)) {
            removedCount++;
          }
        }
      }
    }
  } catch (error) {
    // AI: 忽略权限错误
  }
  
  return removedCount;
}

/**
 * AI: 清理 node_modules 目录
 */
function cleanNodeModules() {
  console.log('\n🧹 清理 node_modules 目录...');
  
  // AI: 只清理主要的包目录，不递归到每个包的依赖
  const topLevelDirs = fs.readdirSync(NODE_MODULES_DIR);
  let removedCount = 0;
  
  for (const dir of topLevelDirs) {
    const dirPath = path.join(NODE_MODULES_DIR, dir);
    
    if (!fs.statSync(dirPath).isDirectory()) continue;
    if (dir.startsWith('@')) {
      // AI: 处理 scoped packages
      const scopedDirs = fs.readdirSync(dirPath);
      for (const scopedDir of scopedDirs) {
        const scopedPath = path.join(dirPath, scopedDir);
        if (fs.statSync(scopedPath).isDirectory()) {
          removedCount += findAndRemoveFiles(scopedPath, NODE_MODULES_PATTERNS, FILE_EXTENSIONS_TO_REMOVE);
        }
      }
    } else {
      removedCount += findAndRemoveFiles(dirPath, NODE_MODULES_PATTERNS, FILE_EXTENSIONS_TO_REMOVE);
    }
  }
  
  console.log(`  已清理 ${removedCount} 个文件`);
}

/**
 * AI: 获取目录大小
 */
function getDirSize(dir) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        size += getDirSize(fullPath);
      } else if (entry.isFile()) {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch (error) {
    // 忽略错误
  }
  return size;
}

/**
 * AI: 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * AI: 主函数
 */
async function main() {
  console.log('🚀 开始清理生产环境构建文件...\n');
  
  // AI: 记录清理前的大小
  const beforeNextSize = getDirSize(NEXT_DIR);
  const beforeNodeModulesSize = getDirSize(NODE_MODULES_DIR);
  const beforeTotal = beforeNextSize + beforeNodeModulesSize;
  
  console.log(`📊 清理前大小:`);
  console.log(`  .next: ${formatSize(beforeNextSize)}`);
  console.log(`  node_modules: ${formatSize(beforeNodeModulesSize)}`);
  console.log(`  总计: ${formatSize(beforeTotal)}`);
  
  // AI: 执行清理
  cleanNextDir();
  cleanNodeModules();
  
  // AI: 记录清理后的大小
  const afterNextSize = getDirSize(NEXT_DIR);
  const afterNodeModulesSize = getDirSize(NODE_MODULES_DIR);
  const afterTotal = afterNextSize + afterNodeModulesSize;
  const saved = beforeTotal - afterTotal;
  
  console.log(`\n📊 清理后大小:`);
  console.log(`  .next: ${formatSize(afterNextSize)}`);
  console.log(`  node_modules: ${formatSize(afterNodeModulesSize)}`);
  console.log(`  总计: ${formatSize(afterTotal)}`);
  console.log(`\n💾 节省空间: ${formatSize(saved)} (${((saved / beforeTotal) * 100).toFixed(1)}%)`);
  
  console.log('\n✅ 清理完成！现在可以运行 pnpm build 进行构建。');
}

// AI: 执行主函数
main().catch(error => {
  console.error('❌ 清理过程中出错:', error);
  process.exit(1);
});
