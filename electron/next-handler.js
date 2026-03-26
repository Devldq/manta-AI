// AI start: Next.js Protocol Handler - Fork + IPC 通信版本
const { fork } = require('child_process');
const path = require('path');
const http = require('http');

// AI: 创建 Protocol Handler（使用 fork 启动独立 Node.js 进程）
function createHandler({ standaloneDir, protocol, protocolScheme }) {
  console.log('🔧 Creating handler with:', { standaloneDir, protocolScheme });
  
  let actualPort = null;
  let isReady = false;
  let serverProcess = null;
  
  // AI: ✅ 关键修复：使用 fork 启动独立的 Node.js 进程
  // fork 会自动使用正确的 Node.js 运行时，而不是 Electron 可执行文件
  const preparePromise = new Promise((resolve, reject) => {
    try {
      const wrapperScriptPath = path.join(__dirname, 'next-server-wrapper.js');
      
      console.log('📦 Wrapper script path:', wrapperScriptPath);
      console.log('📁 Standalone dir:', standaloneDir);
      
      // AI: 使用 fork 启动 wrapper 脚本（IPC 通信）
      serverProcess = fork(wrapperScriptPath, [], {
        env: {
          ...process.env,
          STANDALONE_DIR: standaloneDir,
          NODE_ENV: 'production',
        },
        cwd: standaloneDir,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // 启用 IPC
      });
      
      // AI: 监听子进程的 stdout
      if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          console.log('[Next.js]', data.toString().trim());
        });
      }
      
      // AI: 监听子进程的 stderr
      if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          console.error('[Next.js Error]', data.toString().trim());
        });
      }
      
      // AI: ⚠️ 关键：通过 IPC 接收端口信息
      serverProcess.on('message', (message) => {
        console.log('📨 Received message from child process:', message);
        
        if (message.type === 'ready' && message.port) {
          actualPort = message.port;
          isReady = true;
          console.log('✅ Next.js server started on port:', actualPort);
          resolve();
        } else if (message.type === 'error') {
          console.error('❌ Child process error:', message.error);
          reject(new Error(message.error));
        }
      });
      
      serverProcess.on('error', (error) => {
        console.error('❌ Failed to fork server process:', error);
        reject(error);
      });
      
      serverProcess.on('exit', (code, signal) => {
        console.warn('⚠️ Next.js server process exited:', { code, signal });
        isReady = false;
        actualPort = null;
      });
      
      // AI: 超时保护（60秒）
      setTimeout(() => {
        if (!isReady) {
          console.error('❌ Next.js server startup timeout (60s)');
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill();
          }
          reject(new Error('Next.js server startup timeout (60s)'));
        }
      }, 60000);
      
    } catch (error) {
      console.error('❌ Failed to start server process:', error);
      reject(error);
    }
  });
  
  // AI: 代理请求到 Next.js 服务器
  async function proxyRequest(electronRequest) {
    // AI: 等待服务器准备完成
    if (!isReady) {
      console.warn('⏳ Next.js server is not ready yet, waiting...');
      await preparePromise;
    }
    
    if (!actualPort) {
      throw new Error('Next.js server port is not available');
    }
    
    // AI: 解析 URL（app://index -> /）
    const reqUrl = electronRequest.url.replace(`${protocolScheme}://`, '/').replace(/^\/+/, '/');
    console.log('📨 Proxying request:', reqUrl, '-> http://127.0.0.1:' + actualPort);
    
    // AI: 发起 HTTP 请求到 Next.js 服务器
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: actualPort,
        path: reqUrl,
        method: electronRequest.method || 'GET',
        headers: electronRequest.headers || {},
      };
      
      const req = http.request(options, (res) => {
        const chunks = [];
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          
          // AI: 转换为 Fetch API Response
          const headers = new Headers();
          Object.entries(res.headers).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach(v => headers.append(key, v));
            } else {
              headers.set(key, value);
            }
          });
          
          resolve(new Response(body, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers,
          }));
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Proxy request error:', error);
        reject(error);
      });
      
      // AI: 处理 POST/PUT 数据
      if (electronRequest.uploadData) {
        electronRequest.uploadData.forEach((item) => {
          if (item.bytes) {
            req.write(item.bytes);
          }
        });
      }
      
      req.end();
    });
  }
  
  // AI: 创建 Protocol Handler
  function createInterceptor() {
    protocol.handle(protocolScheme, async (request) => {
      try {
        console.log('🔄 Intercepting:', request.url);
        return await proxyRequest(request);
      } catch (error) {
        console.error('❌ Protocol handler error:', error);
        return new Response(
          `<html><body><h1>Internal Server Error</h1><pre>${error.message}</pre></body></html>`,
          { 
            status: 500,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      }
    });
    
    console.log(`✅ Protocol handler registered for: ${protocolScheme}://`);
  }
  
  // AI: 清理函数（应用退出时调用）
  function cleanup() {
    if (serverProcess && !serverProcess.killed) {
      console.log('🧹 Killing Next.js server process...');
      serverProcess.kill();
    }
  }
  
  return { 
    createInterceptor,
    preparePromise,
    cleanup,
  };
}

module.exports = { createHandler };
// AI end: Next.js Protocol Handler
