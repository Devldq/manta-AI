'use client'
import { useEffect, useState } from 'react'
import type { WorkflowConfig } from '@/lib/types'
import { RefreshCw, Plus, Trash2 } from 'lucide-react'

/* AI start: 工作流配置页面 */

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<WorkflowConfig | null>(null)
  const [yamlText, setYamlText] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const fetchWorkflows = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()
      setWorkflows(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkflows()
  }, [])

  const handleSelect = async (wf: WorkflowConfig) => {
    setSelected(wf)
    setMsg(null)
    const res = await fetch(`/api/workflows/${wf.id}`)
    const data = await res.json()
    // AI: 将工作流对象转为 YAML 格式展示
    const yaml = await import('js-yaml')
    setYamlText(yaml.dump(data))
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const yaml = await import('js-yaml')
      const parsed = yaml.load(yamlText) as WorkflowConfig
      await fetch(`/api/workflows/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      setMsg('✅ 保存成功')
      fetchWorkflows()
    } catch (e: unknown) {
      setMsg(`❌ ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定删除工作流 "${id}" 吗？`)) return
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
    setSelected(null)
    setYamlText('')
    fetchWorkflows()
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">⚙️ 工作流配置</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>{workflows.length} 个工作流</p>
        </div>
        <button
          onClick={fetchWorkflows}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
          style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* AI: 左侧工作流列表 */}
        <div className="w-64 flex-shrink-0 border-r overflow-y-auto" style={{ borderColor: '#2d3148' }}>
          <div className="p-3 space-y-2">
            {workflows.map(wf => (
              <div
                key={wf.id}
                onClick={() => handleSelect(wf)}
                className="p-3 rounded-lg cursor-pointer"
                style={{
                  background: selected?.id === wf.id ? '#252a3a' : '#1e2130',
                  border: `1px solid ${selected?.id === wf.id ? '#3b82f6' : '#2d3148'}`,
                }}
              >
                <div className="text-sm font-medium text-white">{wf.name}</div>
                <div className="text-xs mt-1" style={{ color: '#8892a4' }}>{wf.id}</div>
                {wf.description && (
                  <div className="text-xs mt-1 line-clamp-2" style={{ color: '#4a5568' }}>{wf.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* AI: 右侧 YAML 编辑器 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
                <span className="text-sm font-medium text-white">{selected.name}</span>
                <div className="flex items-center gap-2">
                  {msg && <span className="text-xs" style={{ color: msg.startsWith('✅') ? '#68d391' : '#fc8181' }}>{msg}</span>}
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded text-xs"
                    style={{ color: '#fc8181', background: '#2d1515' }}
                  >
                    <Trash2 size={11} />删除
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium text-white"
                    style={{ background: '#3b82f6' }}
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
              <textarea
                value={yamlText}
                onChange={e => setYamlText(e.target.value)}
                className="flex-1 p-4 text-xs font-mono text-white resize-none focus:outline-none"
                style={{ background: '#0f1117', color: '#a0aec0', lineHeight: 1.7 }}
                spellCheck={false}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-3">⚙️</div>
              <p className="text-sm font-medium text-white">选择一个工作流编辑</p>
              <p className="text-xs mt-1" style={{ color: '#8892a4' }}>支持 YAML 格式直接编辑</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 工作流配置页面 */
