'use client'
import { useEffect, useState, useCallback } from 'react'
import { useAgentsStore } from '@/store/agentsStore'
import type { AgentStats } from '@/lib/types'
import type { OcAgentInfo } from '@/lib/openclawIntegration'
import { RefreshCw, Copy, Shield, Activity, Cpu, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'

/* AI start: Agent 状态页面 — ARM 本地 Agent + OpenClaw 全量代理 */

const AGENT_ICONS: Record<string, string> = {
  architect: '📜',
  dev: '⚔️',
  qa: '⚖️',
  review: '🔍',
  // edict agents
  taizi: '👑',
  zhongshu: '📋',
  menxia: '🔍',
  shangshu: '📮',
  hubu: '💰',
  libu: '📝',
  bingbu: '⚔️',
  xingbu: '⚖️',
  gongbu: '🔧',
  libu_hr: '👥',
  zaochao: '🌅',
}

function getAgentIcon(id: string): string {
  const base = id.replace(/^arm-/, '').split('_g')[0]
  return AGENT_ICONS[base] ?? '🤖'
}

function HealthBar({ health, status }: { health: number; status: AgentStats['status'] }) {
  const color =
    status === 'banned' ? '#ef4444' :
    health >= 80 ? '#22c55e' :
    health >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs" style={{ color: '#8892a4' }}>生命值</span>
        <span className="text-xs font-mono font-bold" style={{ color }}>{health} / 100</span>
      </div>
      <div className="w-full rounded-full h-2" style={{ background: '#0f1117' }}>
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, health))}%`, background: color }}
        />
      </div>
      {health >= 90 && status === 'active' && (
        <div className="text-xs mt-1" style={{ color: '#22c55e' }}>🌟 可复制</div>
      )}
      {health <= 20 && status === 'active' && (
        <div className="text-xs mt-1" style={{ color: '#ef4444' }}>⚠️ 生命值危险</div>
      )}
    </div>
  )
}

function AgentCard({ agent, onClone }: { agent: AgentStats; onClone: (id: string) => void }) {
  const baseId = agent.agentId.split('_g')[0]
  const icon = getAgentIcon(baseId)
  const isBanned = agent.status === 'banned'

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{
        background: '#1e2130',
        border: `1px solid ${isBanned ? '#9b2c2c' : agent.health >= 90 ? '#276749' : '#2d3148'}`,
        opacity: isBanned ? 0.7 : 1,
      }}
    >
      {/* AI: Agent 头部 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: '#0f1117' }}>
            {icon}
          </div>
          <div>
            <div className="font-semibold text-white text-sm">{agent.displayName}</div>
            <div className="text-xs mt-0.5" style={{ color: '#8892a4' }}>
              {agent.agentId} · 第 {agent.generation} 代
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isBanned ? (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#2d1515', color: '#fc8181' }}>
              🚫 封禁
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: '#1a3a2a', color: '#68d391' }}>
              <Activity size={10} />在线
            </span>
          )}
        </div>
      </div>

      {/* AI: 生命值进度条 */}
      <HealthBar health={agent.health} status={agent.status} />

      {/* AI: 统计数据 */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: '完成任务', value: agent.completedTasks },
          { label: '失败任务', value: agent.failedTasks },
          { label: 'Token 消耗', value: agent.totalTokens > 1000 ? `${(agent.totalTokens / 1000).toFixed(1)}k` : agent.totalTokens },
        ].map(item => (
          <div key={item.label} className="text-center p-2 rounded-lg" style={{ background: '#0f1117' }}>
            <div className="text-sm font-bold text-white">{item.value}</div>
            <div className="text-xs mt-0.5" style={{ color: '#4a5568' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* AI: 技能标签 */}
      {agent.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agent.skills.map(skill => (
            <span key={skill} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#252a3a', color: '#a0aec0' }}>
              {skill}
            </span>
          ))}
        </div>
      )}

      {/* AI: 父代信息 */}
      {agent.parentId && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: '#0f1117', color: '#8892a4' }}>
          继承自：{agent.parentId}
        </div>
      )}

      {/* AI: 操作按钮 */}
      {!isBanned && agent.health >= 90 && (
        <button
          onClick={() => onClone(agent.agentId)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: '#1a3a2a', border: '1px solid #276749', color: '#68d391' }}
        >
          <Copy size={12} />
          复制 Agent（继承经验）
        </button>
      )}
    </div>
  )
}

// AI: OpenClaw Agent 卡片
function OcAgentCard({ agent }: { agent: OcAgentInfo }) {
  const [expanded, setExpanded] = useState(false)
  const icon = getAgentIcon(agent.id)
  const isArm = agent.isArmAgent

  // AI: 从 SOUL.md 提取第一行作为描述
  const soulDesc = agent.soulContent
    ? agent.soulContent.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ?? ''
    : ''

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: '#1a1d2e',
        border: `1px solid ${isArm ? '#2d4a7a' : '#252836'}`,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: '#0f1117' }}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white text-sm">{agent.id}</span>
              {isArm && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#63b3ed' }}>
                  ARM
                </span>
              )}
            </div>
            <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: '#5a6580' }}>
              {agent.workspace.replace(process.env.HOME ?? '', '~')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.workspaceExists ? (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#68d391' }}>
              <CheckCircle size={12} />已配置
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#fc8181' }}>
              <AlertCircle size={12} />未配置
            </span>
          )}
          {agent.soulContent && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs p-1 rounded"
              style={{ color: '#8892a4' }}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* AI: 简短描述 */}
      {soulDesc && (
        <div className="text-xs" style={{ color: '#8892a4' }}>{soulDesc.slice(0, 80)}{soulDesc.length > 80 ? '…' : ''}</div>
      )}

      {/* AI: 可通信的 agents */}
      {agent.allowAgents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.allowAgents.map(a => (
            <span key={a} className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1e2130', color: '#718096' }}>
              → {a}
            </span>
          ))}
        </div>
      )}

      {/* AI: 展开显示 SOUL.md 前 300 字符 */}
      {expanded && agent.soulContent && (
        <div
          className="text-xs font-mono p-3 rounded-lg overflow-auto max-h-40"
          style={{ background: '#0a0d14', color: '#8892a4', whiteSpace: 'pre-wrap' }}
        >
          {agent.soulContent.slice(0, 300)}{agent.soulContent.length > 300 ? '\n...' : ''}
        </div>
      )}
    </div>
  )
}

// AI: 初始化状态面板
function InitStatusPanel({
  status,
  onInit,
  initing,
}: {
  status: { isOpenclawAvailable: boolean; allRegistered: boolean; registeredIds: string[]; missingIds: string[] } | null
  onInit: () => void
  initing: boolean
}) {
  if (!status) return null

  if (!status.isOpenclawAvailable) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg flex items-center gap-3" style={{ background: '#1a1d2e', border: '1px solid #252836' }}>
        <AlertCircle size={16} style={{ color: '#f59e0b' }} />
        <div className="flex-1">
          <div className="text-sm text-white">OpenClaw 未安装</div>
          <div className="text-xs mt-0.5" style={{ color: '#8892a4' }}>ARM 使用本地模拟数据运行，安装 OpenClaw 可接入真实 AI Agents</div>
        </div>
      </div>
    )
  }

  if (status.allRegistered) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg flex items-center gap-3" style={{ background: '#0d1f18', border: '1px solid #1a3a2a' }}>
        <CheckCircle size={16} style={{ color: '#68d391' }} />
        <div className="flex-1">
          <div className="text-sm text-white">ARM Agents 已在 OpenClaw 中注册</div>
          <div className="text-xs mt-0.5" style={{ color: '#68d391' }}>
            {status.registeredIds.join(' · ')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 px-4 py-3 rounded-lg flex items-center gap-3" style={{ background: '#1a1510', border: '1px solid #4a3010' }}>
      <AlertCircle size={16} style={{ color: '#f59e0b' }} />
      <div className="flex-1">
        <div className="text-sm text-white">ARM Agents 未完全注册</div>
        <div className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>
          待注册: {status.missingIds.join(', ')}
        </div>
      </div>
      <button
        onClick={onInit}
        disabled={initing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{ background: '#2d4a10', border: '1px solid #4a7a10', color: '#a0e060' }}
      >
        {initing ? <RefreshCw size={12} className="animate-spin" /> : <Cpu size={12} />}
        {initing ? '初始化中...' : '初始化 Agents'}
      </button>
    </div>
  )
}

export default function AgentsPage() {
  const { agents, loading, fetchAgents, cloneAgent } = useAgentsStore()
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocAgents, setOcAgents] = useState<OcAgentInfo[]>([])
  const [ocLoading, setOcLoading] = useState(false)
  const [initStatus, setInitStatus] = useState<{
    isOpenclawAvailable: boolean
    allRegistered: boolean
    registeredIds: string[]
    missingIds: string[]
  } | null>(null)
  const [initing, setIniting] = useState(false)
  const [showOcPanel, setShowOcPanel] = useState(true)

  useEffect(() => {
    fetchAgents()
    const timer = setInterval(fetchAgents, 15000)
    return () => clearInterval(timer)
  }, [fetchAgents])

  // AI: 加载 OpenClaw 初始化状态和 agents 列表
  const fetchOcData = useCallback(async () => {
    setOcLoading(true)
    try {
      const [initRes, agentsRes] = await Promise.all([
        fetch('/api/openclaw/init'),
        fetch('/api/openclaw/agents'),
      ])
      if (initRes.ok) {
        const data = await initRes.json()
        setInitStatus({
          isOpenclawAvailable: data.isOpenclawAvailable,
          allRegistered: data.allRegistered,
          registeredIds: data.registeredIds,
          missingIds: data.missingIds,
        })
      }
      if (agentsRes.ok) {
        setOcAgents(await agentsRes.json())
      }
    } catch {
      // silent
    } finally {
      setOcLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOcData()
  }, [fetchOcData])

  // AI: 执行初始化脚本
  const handleInit = async () => {
    setIniting(true)
    try {
      const res = await fetch('/api/openclaw/init', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMsg('✅ ARM Agents 初始化成功！')
        await fetchOcData()
      } else {
        setMsg(`❌ 初始化失败: ${data.message}`)
      }
    } catch {
      setMsg('❌ 初始化请求失败')
    } finally {
      setIniting(false)
    }
  }

  const handleClone = async (agentId: string) => {
    setCloningId(agentId)
    try {
      const newAgent = await cloneAgent(agentId)
      setMsg(`✅ 复制成功！新 Agent: ${newAgent.agentId}`)
    } catch (e: unknown) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally {
      setCloningId(null)
    }
  }

  const activeAgents = agents.filter(a => a.status !== 'banned')
  const bannedAgents = agents.filter(a => a.status === 'banned')
  const armOcAgents = ocAgents.filter(a => a.isArmAgent)
  const otherOcAgents = ocAgents.filter(a => !a.isArmAgent)

  return (
    <div className="flex flex-col h-screen">
      {/* AI: 顶部标题栏 */}
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">🧬 Agent</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>
            ARM: {activeAgents.length} 在线 · {bannedAgents.length} 封禁
            {ocAgents.length > 0 && ` · OpenClaw: ${ocAgents.length} 个代理`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { fetchAgents(); fetchOcData() }}
            disabled={loading || ocLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
          >
            <RefreshCw size={12} className={loading || ocLoading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* AI: 消息提示 */}
        {msg && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}>
            {msg}
            <button onClick={() => setMsg(null)} className="ml-2 text-gray-500">×</button>
          </div>
        )}

        {/* AI: OpenClaw 初始化状态 */}
        <InitStatusPanel status={initStatus} onInit={handleInit} initing={initing} />

        {/* AI: ARM 本地 Agent 在线 */}
        <div className="mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>
            ARM 本地 Agents
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {activeAgents.map(agent => (
              <AgentCard key={agent.agentId} agent={agent} onClone={handleClone} />
            ))}
          </div>
        </div>

        {/* AI: 封禁的 Agent */}
        {bannedAgents.length > 0 && (
          <div className="mt-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} style={{ color: '#ef4444' }} />
              <h2 className="text-sm font-medium" style={{ color: '#8892a4' }}>已封禁</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {bannedAgents.map(agent => (
                <AgentCard key={agent.agentId} agent={agent} onClone={handleClone} />
              ))}
            </div>
          </div>
        )}

        {/* AI: OpenClaw 所有代理面板 */}
        {ocAgents.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowOcPanel(v => !v)}
              className="flex items-center gap-2 mb-4 w-full text-left"
            >
              <Cpu size={14} style={{ color: '#63b3ed' }} />
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#4a5568' }}>
                OpenClaw 所有代理（{ocAgents.length}）
              </h2>
              {showOcPanel ? <ChevronUp size={14} style={{ color: '#4a5568' }} /> : <ChevronDown size={14} style={{ color: '#4a5568' }} />}
            </button>

            {showOcPanel && (
              <>
                {/* AI: ARM 注册的 agents */}
                {armOcAgents.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs mb-2 px-1" style={{ color: '#63b3ed' }}>
                      ARM Agents（{armOcAgents.length}）
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {armOcAgents.map(a => (
                        <OcAgentCard key={a.id} agent={a} />
                      ))}
                    </div>
                  </div>
                )}

                {/* AI: 其他 OpenClaw agents */}
                {otherOcAgents.length > 0 && (
                  <div>
                    <div className="text-xs mb-2 px-1" style={{ color: '#718096' }}>
                      其他代理（{otherOcAgents.length}）
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {otherOcAgents.map(a => (
                        <OcAgentCard key={a.id} agent={a} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* AI: 未使用变量消除（仅用于触发 cloningId 依赖） */}
        {cloningId && (
          <div className="hidden">{cloningId}</div>
        )}
      </div>
    </div>
  )
}
/* AI end: Agent 状态页面 */
