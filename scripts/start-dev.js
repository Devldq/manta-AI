const { spawn } = require('child_process');
const { existsSync } = require('fs');
const http = require('http');
const { homedir } = require('os');
const { join } = require('path');

const BASE_DIR = process.cwd();
const BACKEND_PORT = 3001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

function resolveBootstrapPath({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
  exists = existsSync,
} = {}) {
  let bootstrapPath = env.MANTA_BOOTSTRAP_PATH;
  if (!bootstrapPath) {
    if (platform === 'darwin') {
      bootstrapPath = join(homeDir, 'Library', 'Application Support', 'Electron', 'ash-bootstrap.json');
    } else if (platform === 'win32') {
      bootstrapPath = join(env.APPDATA || join(homeDir, 'AppData', 'Roaming'), 'Electron', 'ash-bootstrap.json');
    } else {
      bootstrapPath = join(env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'Electron', 'ash-bootstrap.json');
    }
  }

  if (!exists(bootstrapPath)) {
    throw new Error(
      `Storage bootstrap not found at ${bootstrapPath}. ` +
      'Run pnpm run dev:desktop once to initialize storage, or set MANTA_BOOTSTRAP_PATH explicitly.',
    );
  }
  return bootstrapPath;
}

function backendEnvironment(bootstrapPath, env = process.env) {
  return { ...env, MANTA_BOOTSTRAP_PATH: bootstrapPath };
}

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
  const bootstrapPath = resolveBootstrapPath();

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
    env: backendEnvironment(bootstrapPath),
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

module.exports = { backendEnvironment, resolveBootstrapPath };

if (require.main === module) main().catch((error) => {
  console.error('[Dev] Error:', error.message);
  process.exitCode = 1;
});
