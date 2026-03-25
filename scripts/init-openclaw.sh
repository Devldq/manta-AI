#!/bin/bash
# AI start: ARM · OpenClaw Agent 初始化脚本
# 参照 edict install.sh，为 ARM 的 4 个 Agent 在 OpenClaw 中注册 Workspace
# 如果已初始化则跳过，直接加载

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_HOME="$HOME/.openclaw"
OC_CFG="$OC_HOME/openclaw.json"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

# ARM 的 4 个 Agent
ARM_AGENTS=(architect dev qa review)

# ── 检查 OpenClaw 是否可用 ──────────────────────────────────
check_openclaw() {
  if ! command -v openclaw &>/dev/null; then
    warn "未找到 openclaw CLI，跳过 OpenClaw 初始化"
    warn "ARM 控制台仍可使用本地模拟 Agent 数据"
    exit 0
  fi
  if [ ! -f "$OC_CFG" ]; then
    warn "未找到 openclaw.json，请先运行 openclaw 完成初始化"
    exit 0
  fi
  log "OpenClaw 已安装: $(openclaw --version 2>/dev/null || echo 'OK')"
}

# ── 创建 Workspace 并写入 SOUL.md ──────────────────────────
create_workspaces() {
  info "创建 ARM Agent Workspace..."
  for agent in "${ARM_AGENTS[@]}"; do
    ws="$OC_HOME/workspace-arm-$agent"
    mkdir -p "$ws/skills"

    # 写入 SOUL.md（如已存在则备份）
    soul_src="$REPO_DIR/agents/$agent/SOUL.md"
    soul_dst="$ws/SOUL.md"
    if [ -f "$soul_src" ]; then
      if [ -f "$soul_dst" ]; then
        cp "$soul_dst" "$soul_dst.bak.$(date +%Y%m%d-%H%M%S)"
      fi
      sed "s|__REPO_DIR__|$REPO_DIR|g" "$soul_src" > "$soul_dst"
    fi

    # 写入通用 AGENTS.md
    cat > "$ws/AGENTS.md" << 'AGENTS_EOF'
# AGENTS.md · ARM 工作协议

1. 接到任务先回复"已收到"。
2. 输出必须包含：任务ID、结果摘要、产出物路径。
3. 完成后更新任务状态。
4. 涉及代码变更，附上文件路径和关键改动说明。
AGENTS_EOF

    log "Workspace: $ws"
  done
}

# ── 注册 Agent 到 openclaw.json ────────────────────────────
register_agents() {
  info "注册 ARM Agents 到 OpenClaw..."

  python3 << PYEOF
import json, pathlib, sys

cfg_path = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
cfg = json.loads(cfg_path.read_text())

ARM_AGENTS = [
  {
    "id": "arm-architect",
    "workspace": str(pathlib.Path.home() / '.openclaw/workspace-arm-architect'),
    "subagents": {"allowAgents": ["arm-dev", "arm-qa", "arm-review"]}
  },
  {
    "id": "arm-dev",
    "workspace": str(pathlib.Path.home() / '.openclaw/workspace-arm-dev'),
    "subagents": {"allowAgents": ["arm-architect"]}
  },
  {
    "id": "arm-qa",
    "workspace": str(pathlib.Path.home() / '.openclaw/workspace-arm-qa'),
    "subagents": {"allowAgents": ["arm-architect"]}
  },
  {
    "id": "arm-review",
    "workspace": str(pathlib.Path.home() / '.openclaw/workspace-arm-review'),
    "subagents": {"allowAgents": ["arm-architect"]}
  },
]

agents_cfg = cfg.setdefault('agents', {})
agents_list = agents_cfg.get('list', [])
existing_ids = {a['id'] for a in agents_list}

added = 0
for ag in ARM_AGENTS:
    ag_id = ag['id']
    if ag_id not in existing_ids:
        agents_list.append(ag)
        added += 1
        print(f'  + added: {ag_id}')
    else:
        print(f'  ~ exists: {ag_id} (skipped)')

agents_cfg['list'] = agents_list
cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))
print(f'Done: {added} ARM agents added to openclaw.json')
PYEOF

  log "ARM Agents 注册完成"
}

# ── 同步 API Key ────────────────────────────────────────────
sync_auth() {
  info "同步 API Key 到 ARM Agents..."
  MAIN_AUTH=$(find "$OC_HOME/agents" -name auth-profiles.json -maxdepth 3 2>/dev/null | head -1)

  if [ -z "$MAIN_AUTH" ] || [ ! -f "$MAIN_AUTH" ]; then
    warn "未找到 auth-profiles.json，跳过 API Key 同步"
    return
  fi

  for agent in "${ARM_AGENTS[@]}"; do
    AGENT_DIR="$OC_HOME/agents/arm-$agent/agent"
    mkdir -p "$AGENT_DIR"
    cp "$MAIN_AUTH" "$AGENT_DIR/auth-profiles.json"
  done
  log "API Key 已同步到 ARM Agents"
}

# ── 重启 Gateway ────────────────────────────────────────────
restart_gateway() {
  info "重启 OpenClaw Gateway..."
  if openclaw gateway restart 2>/dev/null; then
    log "Gateway 重启成功"
  else
    warn "Gateway 重启失败，请手动执行: openclaw gateway restart"
  fi
}

# ── Main ────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🏛️  ARM · OpenClaw Agent 初始化     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

check_openclaw
create_workspaces
register_agents
sync_auth
restart_gateway

echo ""
log "ARM OpenClaw 初始化完成！"
echo "  Agent ID: arm-architect / arm-dev / arm-qa / arm-review"
echo "  Workspace: ~/.openclaw/workspace-arm-*"
# AI end: ARM · OpenClaw Agent 初始化脚本
