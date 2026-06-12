// AI start: Next.js Standalone Wrapper - IPC 通信版本
// 这个文件会被 fork 启动，运行在独立的 Node.js 进程中

const path = require('path');

// AI: 从父进程接收 standalone 目录路径
const standaloneDir = process.env.STANDALONE_DIR;

if (!standaloneDir) {
  console.error('❌ STANDALONE_DIR not provided');
  process.exit(1);
}

console.log('📦 Standalone dir:', standaloneDir);

// AI: 设置环境变量
process.env.PORT = '0'; // 随机端口
process.env.HOSTNAME = '127.0.0.1';
process.env.NODE_ENV = 'production';

// AI: 切换到 standalone 目录
process.chdir(standaloneDir);

// AI: 拦截 startServer 以获取端口
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'next/dist/server/lib/start-server') {
    const startServerModule = originalRequire.apply(this, arguments);
    const originalStartServer = startServerModule.startServer;
    
    startServerModule.startServer = async function(options) {
      console.log('🚀 Starting Next.js server...');
      
      const server = await originalStartServer.call(this, options);
      
      if (server && server.address) {
        const address = server.address();
        const port = address.port;
        
        console.log('✅ Next.js server started on port:', port);
        
        // AI: 通过 IPC 发送端口给父进程
        if (process.send) {
          process.send({ type: 'ready', port });
        }
      }
      
      return server;
    };
    
    return startServerModule;
  }
  
  return originalRequire.apply(this, arguments);
};

// AI: 加载 standalone server.js
try {
  const serverScriptPath = path.join(standaloneDir, 'server.js');
  console.log('⏳ Loading server script:', serverScriptPath);
  require(serverScriptPath);
} catch (error) {
  console.error('❌ Failed to load server:', error);
  if (process.send) {
    process.send({ type: 'error', error: error.message });
  }
  process.exit(1);
}
