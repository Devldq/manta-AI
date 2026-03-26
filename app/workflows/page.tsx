/* AI start: 工作流编排主页面 — 可视化画布 + YAML 双视图 */
'use client'
import { useEffect, useState, useCallback } from 'react'
import type { WorkflowConfig } from '@/lib/types'
import { RefreshCw, Plus, Trash2, Save, Code2, GitGraph } from 'lucide-react'
import dynamic from 'next/dynamic'
import NodeEditor from './NodeEditor'
import NewWorkflowModal from './NewWorkflowModal'

// AI: 动态导入画布（避免 SSR 问题）
const WorkflowCanvas = dynamic(() => import('./WorkflowCanvas'), { ssr: false })

type ViewMode = 'canvas' | 'yaml'

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<WorkflowConfig | null>(null)
  const [yamlText, setYamlText] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('canvas')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  // AI: 追踪 yaml 是否被手动编辑（与画布数据不同步）
  const [yamlDirty, setYamlDirty] = useState(false)

  // AI: 加载所有工作流列表
  const fetchWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()
      setWorkflows(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])

  // AI: 将 WorkflowConfig 对象序列化为 YAML 字符串
  const configToYaml = useCallback(async (config: WorkflowConfig) => {
    const yaml = await import('js-yaml')
    return yaml.dump(config, { lineWidth: 120 })
  }, [])

  // AI: 选中某个工作流，从 API 加载完整配置
  const handleSelect = useCallback(async (wf: WorkflowConfig) => {
    setMsg(null)
    setSelectedNodeId(null)
    setYamlDirty(false)
    const res = await fetch(`/api/workflows/${wf.id}`)
    const data: WorkflowConfig = await res.json()
    setSelected(data)
    const text = await configToYaml(data)
    setYamlText(text)
  }, [configToYaml])

  // AI: 从画布更新工作流数据（实时，不保存）
  const handleUpdateWorkflow = useCallback(async (updated: WorkflowConfig) => {
    setSelected(updated)
    if (!yamlDirty) {
      const text = await configToYaml(updated)
      setYamlText(text)
    }
  }, [configToYaml, yamlDirty])

  // AI: 切换到 YAML 视图时，重新序列化最新数据
  const handleSwitchToYaml = useCallback(async () => {
    if (selected && !yamlDirty) {
      const text = await configToYaml(selected)
      setYamlText(text)
    }
    setViewMode('yaml')
  }, [selected, configToYaml, yamlDirty])

  // AI: 从 YAML 文本解析并更新画布数据（切换到画布时触发）
  const handleSwitchToCanvas = useCallback(async () => {
    if (!selected || !yamlDirty) {
      setViewMode('canvas')
      return
    }
    try {
      const yaml = await import('js-yaml')
      const parsed = yaml.load(yamlText) as WorkflowConfig
      setSelected(parsed)
      setYamlDirty(false)
      setMsg(null)
    } catch (e: unknown) {
      setMsg(`❌ YAML 解析失败：${(e as Error).message}`)
      return
    }
    setViewMode('canvas')
  }, [selected, yamlText, yamlDirty])

  // AI: 保存当前工作流（若在 YAML 视图，先解析 YAML；若在画布视图，直接用 selected）
  const handleSave = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    setMsg(null)
    try {
      let toSave: WorkflowConfig = selected
      if (viewMode === 'yaml') {
        const yaml = await import('js-yaml')
        toSave = yaml.load(yamlText) as WorkflowConfig
      }
      const res = await fetch(`/api/workflows/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave),
      })
      if (!res.ok) throw new Error('服务器返回错误')
      setSelected(toSave)
      setYamlDirty(false)
      setMsg('✅ 保存成功')
      fetchWorkflows()
      setTimeout(() => setMsg(null), 2500)
    } catch (e: unknown) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [selected, viewMode, yamlText, fetchWorkflows])

  // AI: 删除工作流
  const handleDelete = useCallback(async () => {
    if (!selected) return
    if (!confirm(`确定删除工作流 "${selected.name}" 吗？`)) return
    await fetch(`/api/workflows/${selected.id}`, { method: 'DELETE' })
    setSelected(null)
    setYamlText('')
    setSelectedNodeId(null)
    fetchWorkflows()
  }, [selected, fetchWorkflows])

  // AI: 新建工作流回调
  const handleCreated = useCallback((wf: WorkflowConfig) => {
    setWorkflows(prev => [...prev, wf])
    handleSelect(wf)
  }, [handleSelect])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* AI: 顶部标题栏 */}
      <div
        className="flex-shrink-0 px-6 py-3 border-b flex items-center justify-between"
        style={{ borderColor: '#2d3148' }}
      >
        <div>
          <h1 className="text-base font-bold text-white">⚙️ 工作流配置</h1>
          <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>{workflows.length} 个工作流</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchWorkflows}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ background: '#3b82f6' }}
          >
            <Plus size={11} />
            新建工作流
          </button>
        </div>
      </div>

      {/* AI: 主体区域：左侧列表 + 右侧编辑区 */}
      <div className="flex flex-1 overflow-hidden">

        {/* AI: 左侧工作流列表 */}
        <div
          className="w-56 flex-shrink-0 border-r overflow-y-auto"
          style={{ borderColor: '#2d3148', background: '#13151f' }}
        >
          <div className="p-2 space-y-1">
            {workflows.length === 0 && !loading && (
              <div className="px-3 py-8 text-center">
                <div className="text-2xl mb-2">📭</div>
                <p className="text-xs" style={{ color: '#4a5568' }}>暂无工作流</p>
              </div>
            )}
            {workflows.map(wf => (
              <button
                key={wf.id}
                onClick={() => handleSelect(wf)}
                className="w-full text-left p-3 rounded-lg transition-colors"
                style={{
                  background: selected?.id === wf.id ? '#252a3a' : 'transparent',
                  border: `1px solid ${selected?.id === wf.id ? '#3b82f6' : 'transparent'}`,
                }}
              >
                <div className="text-xs font-semibold text-white truncate">{wf.name}</div>
                <div className="text-xs mt-0.5 font-mono" style={{ color: '#4a5568' }}>{wf.id}</div>
                {wf.description && (
                  <div className="text-xs mt-1 line-clamp-2 leading-relaxed" style={{ color: '#8892a4' }}>
                    {wf.description}
                  </div>
                )}
                <div className="text-xs mt-1" style={{ color: '#4a5568' }}>
                  {wf.steps?.length ?? 0} 步骤
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* AI: 右侧编辑区 */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* AI: 工具栏 */}
            <div
              className="flex-shrink-0 px-4 py-2 border-b flex items-center justify-between"
              style={{ borderColor: '#2d3148' }}
            >
              {/* AI: 视图切换 Tab */}
              <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: '#1a1d2e' }}>
                <button
                  onClick={handleSwitchToCanvas}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
                  style={{
                    background: viewMode === 'canvas' ? '#252a3a' : 'transparent',
                    color: viewMode === 'canvas' ? '#fff' : '#4a5568',
                    border: viewMode === 'canvas' ? '1px solid #3b82f6' : '1px solid transparent',
                  }}
                >
                  <GitGraph size={12} />可视化编排
                </button>
                <button
                  onClick={handleSwitchToYaml}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
                  style={{
                    background: viewMode === 'yaml' ? '#252a3a' : 'transparent',
                    color: viewMode === 'yaml' ? '#fff' : '#4a5568',
                    border: viewMode === 'yaml' ? '1px solid #3b82f6' : '1px solid transparent',
                  }}
                >
                  <Code2 size={12} />YAML 源码
                </button>
              </div>

              {/* AI: 右侧操作按钮 */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white truncate max-w-40">{selected.name}</span>
                {msg && (
                  <span className="text-xs" style={{ color: msg.startsWith('✅') ? '#68d391' : '#fc8181' }}>
                    {msg}
                  </span>
                )}
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-xs"
                  style={{ color: '#fc8181', background: '#2d1515', border: '1px solid #5c2020' }}
                >
                  <Trash2 size={11} />删除
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium text-white"
                  style={{ background: saving ? '#1e4080' : '#3b82f6' }}
                >
                  <Save size={11} />
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>

            {/* AI: 画布视图 */}
            {viewMode === 'canvas' && (
              <div className="flex-1 flex overflow-hidden">
                <WorkflowCanvas
                  workflow={selected}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onUpdateWorkflow={handleUpdateWorkflow}
                />
                <NodeEditor
                  workflow={selected}
                  stepId={selectedNodeId}
                  onClose={() => setSelectedNodeId(null)}
                  onUpdateWorkflow={handleUpdateWorkflow}
                />
              </div>
            )}

            {/* AI: YAML 视图 */}
            {viewMode === 'yaml' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* AI: YAML 提示栏 */}
                <div
                  className="flex-shrink-0 px-4 py-2 flex items-center gap-2 text-xs"
                  style={{ background: '#0f1117', borderBottom: '1px solid #1e2130' }}
                >
                  <Code2 size={11} style={{ color: '#4a5568' }} />
                  <span style={{ color: '#4a5568' }}>
                    直接编辑 YAML — 切换到可视化视图时会自动解析同步
                  </span>
                  {yamlDirty && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: '#2d2a14', color: '#f6d860' }}>
                      未同步到画布
                    </span>
                  )}
                </div>
                <textarea
                  value={yamlText}
                  onChange={e => { setYamlText(e.target.value); setYamlDirty(true) }}
                  className="flex-1 p-4 text-xs font-mono text-white resize-none focus:outline-none"
                  style={{ background: '#0f1117', color: '#a0aec0', lineHeight: 1.8 }}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        ) : (
          /* AI: 未选中工作流时的空状态 */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="text-5xl mb-4 opacity-30">⚙️</div>
            <p className="text-sm font-medium text-white">选择一个工作流开始编排</p>
            <p className="text-xs mt-1" style={{ color: '#4a5568' }}>
              支持可视化节点拖拽编排，以及 YAML 源码直接编辑
            </p>
            <button
              onClick={() => setShowNewModal(true)}
              className="mt-5 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#3b82f6' }}
            >
              <Plus size={14} />新建工作流
            </button>
          </div>
        )}
      </div>

      {/* AI: 新建工作流弹窗 */}
      {showNewModal && (
        <NewWorkflowModal
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
/* AI end: 工作流编排主页面 */
