/**
 * MCP OAuth 2.0 + PKCE 认证模块 — RFC 8252 Loopback Server 模式。
 *
 * 流程：
 * 1. 动态分配随机端口，启动临时 Loopback HTTP Server
 * 2. 生成 PKCE (code_verifier + code_challenge)，构建 authorization URL
 * 3. Electron shell.openExternal 打开系统浏览器授权
 * 4. 浏览器回调 http://127.0.0.1:{port}/callback → Loopback Server 接收 code
 * 5. POST /token 交换 code → access_token + refresh_token
 * 6. Token 持久化到 .mcp-tokens/{serverName}.json
 */
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';

import type { OAuthServerConfig, PKCEParams, StoredTokens, OAuthAuthState } from './types';

// ── 全局状态 ───────────────────────────────────────────────────────────────

/** 等待中的授权请求 Map<serverName, OAuthAuthState> */
const pendingAuths = new Map<string, OAuthAuthState>();

/** 当前活跃的 Loopback Server */
let loopbackServer: http.Server | null = null;
let loopbackPort: number | null = null;

// ── Token 持久化路径 ───────────────────────────────────────────────────────

function getTokenDir(): string {
  // 与项目根目录同级，不污染源码目录
  return path.join(process.cwd(), '.mcp-tokens');
}

function getTokenPath(serverName: string): string {
  return path.join(getTokenDir(), `${serverName}.json`);
}

// ── PKCE 工具 ──────────────────────────────────────────────────────────────

/**
 * 生成 PKCE 参数：code_verifier 和 code_challenge (S256)。
 * code_verifier: 32 字节随机数的 base64url 编码
 * code_challenge: SHA-256(code_verifier) 的 base64url 编码
 */
function generatePKCE(): PKCEParams {
  const codeVerifier = crypto
    .randomBytes(32)
    .toString('base64url')
    .replace(/=/g, '');

  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash.toString('base64url').replace(/=/g, '');

  const state = crypto.randomBytes(16).toString('hex');

  return { codeVerifier, codeChallenge, state };
}

// ── 端口分配 ───────────────────────────────────────────────────────────────

/**
 * 获取一个系统分配的随机可用端口（绑定 127.0.0.1）。
 */
function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('无法获取端口')));
      }
    });
    server.on('error', reject);
  });
}

// ── Loopback Server ────────────────────────────────────────────────────────

/**
 * 启动 Loopback HTTP Server 来接收 OAuth 回调。
 *
 * 监听 GET /callback?code=xxx&state=xxx，收到后：
 * - 匹配 state → 找到对应的 pendingAuth
 * - 调用 exchangeCodeForTokens 交换 token
 * - resolve/reject pendingAuth 的 Promise
 * - 返回浏览器友好页面
 */
async function startLoopbackServer(port: number): Promise<void> {
  if (loopbackServer) {
    // 如果已有运行的 server，关闭它
    await closeLoopbackServer();
  }

  loopbackServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

    // 健康检查
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    // OAuth 回调
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      // 查找匹配 state 的授权请求
      let matchedEntry: [string, OAuthAuthState] | undefined;
      for (const entry of pendingAuths) {
        if (entry[1].pkce.state === state) {
          matchedEntry = entry;
          break;
        }
      }

      if (!matchedEntry) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlPage('授权失败', '找不到匹配的授权请求（state 不匹配）'));
        return;
      }

      const [serverName, authState] = matchedEntry;
      pendingAuths.delete(serverName);

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlPage('授权被拒绝', errorDescription || error));
        authState.reject(new Error(`OAuth 授权失败: ${errorDescription || error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlPage('授权失败', '未收到授权码'));
        authState.reject(new Error('OAuth 回调缺少 authorization code'));
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(
          authState.config,
          code,
          authState.pkce.codeVerifier,
          port,
        );

        await saveTokens(serverName, tokens);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlPage('授权成功', `${serverName} 已成功连接！您可以关闭此页面。`));
        authState.resolve(tokens);

        console.log(`[MCP:OAuth] ${serverName} 授权成功`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[MCP:OAuth] ${serverName} token 交换失败:`, msg);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlPage('授权失败', `Token 交换失败: ${msg}`));
        authState.reject(err instanceof Error ? err : new Error(msg));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return new Promise<void>((resolve, reject) => {
    loopbackServer!.listen(port, '127.0.0.1', () => {
      loopbackPort = port;
      console.log(`[MCP:OAuth] Loopback Server 已启动 → http://127.0.0.1:${port}`);
      resolve();
    });
    loopbackServer!.on('error', reject);
  });
}

/**
 * 关闭 Loopback Server。
 */
function closeLoopbackServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!loopbackServer) {
      resolve();
      return;
    }
    loopbackServer.close(() => {
      loopbackServer = null;
      loopbackPort = null;
      console.log('[MCP:OAuth] Loopback Server 已关闭');
      resolve();
    });
  });
}

// ── HTML 页面渲染 ──────────────────────────────────────────────────────────

function renderHtmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0f0f0f; color: #e0e0e0;
    }
    .card {
      text-align: center; padding: 48px; border-radius: 16px;
      background: #1a1a1a; border: 1px solid #333;
      max-width: 420px; width: 90%;
    }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { font-size: 14px; color: #999; line-height: 1.6; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${title.includes('成功') ? '✅' : '❌'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Token 交换 ─────────────────────────────────────────────────────────────

/**
 * POST /token 用 authorization_code 交换 access_token。
 */
async function exchangeCodeForTokens(
  config: OAuthServerConfig,
  code: string,
  codeVerifier: string,
  redirectPort: number,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `http://127.0.0.1:${redirectPort}/callback`,
    code_verifier: codeVerifier,
    client_id: config.clientId,
  });

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const res = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token 交换失败 (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type || 'bearer',
    expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000),
    scope: data.scope,
  };
}

/**
 * POST /token 用 refresh_token 刷新 access_token。
 */
async function refreshTokens(
  config: OAuthServerConfig,
  refreshToken: string,
): Promise<StoredTokens | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  try {
    const res = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      console.warn(`[MCP:OAuth] refresh token 失败 (${res.status})`);
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    };

    const tokens: StoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,   // 保底使用原来的
      tokenType: data.token_type || 'bearer',
      expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000),
      scope: data.scope,
    };

    return tokens;
  } catch (err) {
    console.warn('[MCP:OAuth] refresh token 网络错误:', err);
    return null;
  }
}

// ── Token 持久化 ───────────────────────────────────────────────────────────

/**
 * 从磁盘加载持久化 token。
 */
export function loadTokens(serverName: string): StoredTokens | null {
  try {
    const tokenPath = getTokenPath(serverName);
    if (!fs.existsSync(tokenPath)) return null;

    const raw = fs.readFileSync(tokenPath, 'utf-8');
    const data = JSON.parse(raw);

    // 基本校验
    if (!data.accessToken || !data.expiresAt) return null;

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenType: data.tokenType || 'bearer',
      expiresAt: data.expiresAt,
      scope: data.scope,
    };
  } catch {
    return null;
  }
}

/**
 * 将 token 持久化到磁盘。
 */
export async function saveTokens(serverName: string, tokens: StoredTokens): Promise<void> {
  const tokenDir = getTokenDir();
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }

  const tokenPath = getTokenPath(serverName);
  await fs.promises.writeFile(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
}

/**
 * 删除持久化 token（登出时调用）。
 */
export function deleteTokens(serverName: string): void {
  const tokenPath = getTokenPath(serverName);
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
  } catch {
    // 忽略删除失败
  }
}

// ── 获取有效 Token ─────────────────────────────────────────────────────────

// 模块级缓存: token 加载后在内存中复用，避免频繁读磁盘
const tokenCache = new Map<string, StoredTokens>();

/**
 * 获取有效的 access_token。
 * - 先从内存缓存取
 * - 缓存未命中时从磁盘加载
 * - 已过期则尝试用 refresh_token 刷新
 * - 刷新成功则持久化并返回新 token
 * - 全部失败返回 null
 *
 * @param serverName MCP Server 名称
 * @param config OAuth 服务器配置（用于刷新 token）
 * @returns 有效的 access_token 或 null
 */
export async function getValidAccessToken(
  serverName: string,
  config: OAuthServerConfig,
): Promise<string | null> {
  let tokens = tokenCache.get(serverName) ?? loadTokens(serverName);

  if (!tokens) return null;

  // 是否在有效期内（提前 60 秒刷新，避免边界问题）
  const bufferMs = 60_000;
  if (tokens.expiresAt > Date.now() + bufferMs) {
    // 缓存未命中时更新缓存
    if (!tokenCache.has(serverName)) {
      tokenCache.set(serverName, tokens);
    }
    return tokens.accessToken;
  }

  // 需要刷新
  if (!tokens.refreshToken) {
    console.warn(`[MCP:OAuth] ${serverName} token 已过期且无 refresh_token`);
    tokenCache.delete(serverName);
    return null;
  }

  console.log(`[MCP:OAuth] ${serverName} token 已过期，尝试刷新...`);
  const refreshed = await refreshTokens(config, tokens.refreshToken);

  if (refreshed) {
    await saveTokens(serverName, refreshed);
    tokenCache.set(serverName, refreshed);
    return refreshed.accessToken;
  }

  tokenCache.delete(serverName);
  return null;
}

// ── 对外 API ───────────────────────────────────────────────────────────────

/**
 * 发起 OAuth 2.0 + PKCE 授权流程。
 *
 * 1. 分配随机端口，启动 Loopback Server
 * 2. 生成 PKCE 参数
 * 3. 构建 authorization URL
 * 4. 返回 { authorizationUrl, state } 供上层打开浏览器
 * 5. 返回 Promise 等待用户完成授权
 *
 * @param serverName MCP Server 名称
 * @param config OAuth 配置
 * @returns { authorizationUrl, state, waitForAuth }
 */
export async function startOAuthFlow(
  serverName: string,
  config: OAuthServerConfig,
): Promise<{
  authorizationUrl: string;
  state: string;
  /** 等待授权完成的 Promise，解析为 token 或 null（用户取消） */
  waitForAuth: Promise<StoredTokens | null>;
}> {
  // 确保 Loopback Server 运行
  if (!loopbackServer) {
    const port = await getRandomPort();
    await startLoopbackServer(port);
  }

  const port = loopbackPort!;

  // 生成 PKCE
  const pkce = generatePKCE();

  // 构建 authorization URL
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: `http://127.0.0.1:${port}/callback`,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    state: pkce.state,
    scope: config.scopes.join(' '),
  });

  const authorizationUrl = `${config.authorizationEndpoint}?${authParams.toString()}`;

  // 创建 Promise 等待授权完成
  const waitForAuth = new Promise<StoredTokens | null>((resolve, reject) => {
    pendingAuths.set(serverName, {
      serverName,
      pkce,
      config,
      resolve,
      reject,
    });

    // 5 分钟超时
    setTimeout(() => {
      if (pendingAuths.has(serverName)) {
        pendingAuths.delete(serverName);
        reject(new Error('OAuth 授权超时（5 分钟）'));
      }
    }, 5 * 60 * 1000);
  });

  console.log(`[MCP:OAuth] 发起 ${serverName} 授权 → ${authorizationUrl}`);
  return { authorizationUrl, state: pkce.state, waitForAuth };
}

/**
 * 检查 server 是否已有有效 token。
 */
export async function checkOAuthToken(
  serverName: string,
  config: OAuthServerConfig,
): Promise<boolean> {
  const token = await getValidAccessToken(serverName, config);
  return token !== null;
}

/**
 * 断开连接时清理 token。
 */
export async function revokeOAuthToken(serverName: string): Promise<void> {
  tokenCache.delete(serverName);
  deleteTokens(serverName);
}

/**
 * 关闭 Loopback Server（进程退出时调用）。
 */
export async function shutdownOAuth(): Promise<void> {
  // 取消所有等待中的授权
  for (const [, state] of pendingAuths) {
    state.reject(new Error('Loopback Server 已关闭'));
  }
  pendingAuths.clear();
  await closeLoopbackServer();
}
