# Stage 1: 前端构建
FROM node:22-alpine AS frontend-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
COPY tsconfig.base.json ./

# 构建 shared + frontend
RUN pnpm --filter @manta/shared build
RUN pnpm --filter @manta/frontend build

# Stage 2: 后端构建
FROM node:22-alpine AS backend-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
COPY tsconfig.base.json ./

# 构建 shared + backend
RUN pnpm --filter @manta/shared build
RUN pnpm --filter @manta/backend build

# Stage 3: 生产运行
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

# 仅安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 复构建产物
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --from=backend-builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist

# 复制插件目录
COPY packages/backend/src/plugins/ ./packages/backend/src/plugins/

# 创建数据目录
RUN mkdir -p /data

# 环境变量
ENV MANTA_PORT=3000
ENV MANTA_HOST=0.0.0.0
ENV MANTA_DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "packages/backend/dist/server.js"]
