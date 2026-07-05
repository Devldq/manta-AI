const { spawn, exec } = require('child_process');
const http = require('http');

const BASE_DIR = process.cwd();
const BACKEND_PORT = 3001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

function waitForBackend(retries = 30, delay = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    function check() {
      attempts++;
      console.log(`[Dev] Waiting for backend... (${attempts}/${retries})`);
      
      http.get(BACKEND_URL + '/api/health', (res) => {
        if (res.statusCode === 200) {
          console.log('[Dev] Backend is ready!');
          resolve();
        } else {
          setTimeout(check, delay);
        }
      }).on('error', () => {
        if (attempts >= retries) {
          reject(new Error('Backend did not start in time'));
        } else {
          setTimeout(check, delay);
        }
      });
    }
    
    check();
  });
}

async function main() {
  console.log('[Dev] Starting shared...');
  const shared = spawn('pnpm', ['dev'], {
    cwd: `${BASE_DIR}/packages/shared`,
    stdio: 'inherit',
    shell: true,
  });

  console.log('[Dev] Starting backend...');
  const backend = spawn('pnpm', ['dev'], {
    cwd: `${BASE_DIR}/packages/backend`,
    stdio: 'inherit',
    shell: true,
  });

  try {
    await waitForBackend();
    
    console.log('[Dev] Starting frontend...');
    const frontend = spawn('pnpm', ['dev'], {
      cwd: `${BASE_DIR}/packages/frontend`,
      stdio: 'inherit',
      shell: true,
    });
  } catch (error) {
    console.error('[Dev] Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);