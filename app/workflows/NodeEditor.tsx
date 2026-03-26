/* AI start: 工作流节点配置侧边面板 */
'use client'
import { useState, useEffect } from 'react'
import type { WorkflowConfig, WorkflowStep } from '@/lib/types'
import { X, Plus, Trash2 } from 'lucide-react'

// AI: 所有节点统一使用相同的 Agent 列表
const AVAILABLE_AGENTS = ['architect', 'dev', 'qa', 'review', 'you']
const STEP_TYPES = ['agent', 'human_in_loop', 'parallel']

interface NodeEditorProps {
  workflow: WorkflowConfig
  stepId: string | null
  onClose: () => void
  onUpdateWorkflow: (wf: WorkflowConfig) => void
}

export default function NodeEditor({ workflow, stepId, onClose, onUpdateWorkflow }: NodeEditorProps) {
  const step = workflow.steps?.find(s => s.id === stepId)
  const [form, setForm] = useState<WorkflowStep | null>(null)

  // AI: stepId 变更时初始化表单
  useEffect(() => {
    if (step) {
      setForm({ ...step })
    } else {
      setForm(null)
    }
  }, [stepId, step?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!step || !form) {
    return (
      <div
        className="w-72 flex-shrink-0 border-l flex flex-col items-center justify-center"
        style={{ borderColor: '#2d3148', background: '#13151f' }}
      >
        <div className="text-4xl mb-2">🖱️</div>
        <p className="text-xs" style={{ color: '#4a5568' }}>点击节点查看配置</p>
      </div>
    )
  }

  // AI: 将表单变更同步回 workflow
  const commitChange = (updated: WorkflowStep) => {
    const newSteps = workflow.steps.map(s => s.id === updated.id ? updated : s)
    onUpdateWorkflow({ ...workflow, steps: newSteps })
  }

  const handleChange = <K extends keyof WorkflowStep>(key: K, value: WorkflowStep[K]) => {
    const updated = { ...form, [key]: value }
    setForm(updated)
    commitChange(updated)
  }

  // AI: 添加 input 字段
  const addInput = () => {
    const updated = { ...form, inputs: [...(form.inputs ?? []), ''] }
    setForm(updated)
    commitChange(updated)
  }
  const setInput = (i: number, val: string) => {
    const inputs = [...(form.inputs ?? [])]
    inputs[i] = val
    const updated = { ...form, inputs }
    setForm(updated)
    commitChange(updated)
  }
  const removeInput = (i: number) => {
    const inputs = (form.inputs ?? []).filter((_, idx) => idx !== i)
    const updated = { ...form, inputs }
    setForm(updated)
    commitChange(updated)
  }

  // AI: 添加 output 字段
  const addOutput = () => {
    const updated = { ...form, outputs: [...(form.outputs ?? []), ''] }
    setForm(updated)
    commitChange(updated)
  }
  const setOutput = (i: number, val: string) => {
    const outputs = [...(form.outputs ?? [])]
    outputs[i] = val
    const updated = { ...form, outputs }
    setForm(updated)
    commitChange(updated)
  }
  const removeOutput = (i: number) => {
    const outputs = (form.outputs ?? []).filter((_, idx) => idx !== i)
    const updated = { ...form, outputs }
    setForm(updated)
    commitChange(updated)
  }

  // AI: actions 键值对编辑（human_in_loop 使用）
  const addAction = () => {
    const updated = { ...form, actions: { ...(form.actions ?? {}), '': '' } }
    setForm(updated)
    commitChange(updated)
  }
  const setAction = (oldKey: string, newKey: string, val: string) => {
    const entries = Object.entries(form.actions ?? {})
    const idx = entries.findIndex(([k]) => k === oldKey)
    if (idx >= 0) entries[idx] = [newKey, val]
    const updated = { ...form, actions: Object.fromEntries(entries) }
    setForm(updated)
    commitChange(updated)
  }
  const removeAction = (key: string) => {
    const entries = Object.entries(form.actions ?? {}).filter(([k]) => k !== key)
    const updated = { ...form, actions: Object.fromEntries(entries) }
    setForm(updated)
    commitChange(updated)
  }

  // AI: 删除当前步骤
  const handleDeleteStep = () => {
    if (!confirm(`确定删除步骤 "${form.name}" 吗？`)) return
    const newSteps = workflow.steps.filter(s => s.id !== form.id)
    onUpdateWorkflow({ ...workflow, steps: newSteps })
    onClose()
  }

  const otherStepIds = workflow.steps?.filter(s => s.id !== form.id).map(s => s.id) ?? []
  const stepType = form.type ?? (form.parallel ? 'parallel' : 'agent')

  return (
    <div
      className="w-72 flex-shrink-0 border-l flex flex-col overflow-hidden"
      style={{ borderColor: '#2d3148', background: '#13151f' }}
    >
      {/* AI: 面板标题 */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <span className="text-sm font-semibold text-white truncate">📝 {form.name}</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* AI: 基本信息 */}
        <section>
          <div className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>基本信息</div>
          <div className="space-y-2">
            <div>
              <label className="block mb-1" style={{ color: '#4a5568' }}>步骤 ID（只读）</label>
              <div className="px-2 py-1.5 rounded text-xs font-mono" style={{ background: '#0f1117', color: '#4a5568', border: '1px solid #1e2130' }}>
                {form.id}
              </div>
            </div>
            <div>
              <label className="block mb-1" style={{ color: '#4a5568' }}>步骤名称</label>
              <input
                value={form.name}
                onChange={e => handleChange('name', e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              />
            </div>
            <div>
              <label className="block mb-1" style={{ color: '#4a5568' }}>类型</label>
              <select
                value={stepType}
                onChange={e => {
                  const v = e.target.value
                  const updated = {
                    ...form,
                    type: v === 'human_in_loop' ? 'human_in_loop' as const : undefined,
                    parallel: v === 'parallel' ? true : undefined,
                  }
                  setForm(updated)
                  commitChange(updated)
                }}
                className="w-full px-2 py-1.5 rounded text-xs text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              >
                {STEP_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* AI: 执行 Agent — 所有节点类型统一显示，选项一致 */}
        <section>
          <div className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>执行 Agent</div>
          <select
            value={form.agent ?? ''}
            onChange={e => handleChange('agent', e.target.value || undefined)}
            className="w-full px-2 py-1.5 rounded text-xs text-white"
            style={{ background: '#0f1117', border: '1px solid #2d3148' }}
          >
            <option value="">-- 不指定 --</option>
            {AVAILABLE_AGENTS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {/* AI: 提示：空时自动继承上一节点输出 */}
          <p className="mt-1.5 text-xs leading-relaxed" style={{ color: '#4a5568' }}>
            📎 空时自动继承上一节点的输出作为输入
          </p>
        </section>

        {/* AI: Inputs — 默认空=自动继承，也可手动追加额外字段 */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: '#8892a4' }}>Inputs</span>
            <button onClick={addInput} className="flex items-center gap-0.5 text-xs" style={{ color: '#3b82f6' }}>
              <Plus size={10} />添加
            </button>
          </div>
          <p className="mb-2 text-xs" style={{ color: '#4a5568' }}>
            {(form.inputs ?? []).length === 0 ? '（空 · 自动继承上一节点输出）' : ''}
          </p>
          <div className="space-y-1.5">
            {(form.inputs ?? []).map((inp, i) => (
              <div key={i} className="flex gap-1">
                <input
                  value={inp}
                  onChange={e => setInput(i, e.target.value)}
                  placeholder="字段名"
                  className="flex-1 px-2 py-1 rounded text-xs text-white"
                  style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                />
                <button onClick={() => removeInput(i)} className="text-gray-600 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* AI: Outputs — 声明本节点的输出字段，作为下一节点的默认输入 */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: '#8892a4' }}>Outputs</span>
            <button onClick={addOutput} className="flex items-center gap-0.5 text-xs" style={{ color: '#3b82f6' }}>
              <Plus size={10} />添加
            </button>
          </div>
          <p className="mb-2 text-xs" style={{ color: '#4a5568' }}>
            {(form.outputs ?? []).length === 0 ? '（空 · 运行时自动收集产出）' : ''}
          </p>
          <div className="space-y-1.5">
            {(form.outputs ?? []).map((out, i) => (
              <div key={i} className="flex gap-1">
                <input
                  value={out}
                  onChange={e => setOutput(i, e.target.value)}
                  placeholder="字段名"
                  className="flex-1 px-2 py-1 rounded text-xs text-white"
                  style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                />
                <button onClick={() => removeOutput(i)} className="text-gray-600 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* AI: Next 步骤选择（agent 类型） */}
        {stepType === 'agent' && (
          <section>
            <div className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>下一步（next）</div>
            <select
              value={form.next ?? ''}
              onChange={e => handleChange('next', e.target.value || undefined)}
              className="w-full px-2 py-1.5 rounded text-xs text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            >
              <option value="">-- 无 --</option>
              {otherStepIds.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </section>
        )}

        {/* AI: Actions（human_in_loop 使用） */}
        {stepType === 'human_in_loop' && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: '#8892a4' }}>Actions</span>
              <button onClick={addAction} className="flex items-center gap-0.5 text-xs" style={{ color: '#3b82f6' }}>
                <Plus size={10} />添加
              </button>
            </div>
            <div className="space-y-1.5">
              {Object.entries(form.actions ?? {}).map(([key, val]) => (
                <div key={key} className="flex gap-1 items-center">
                  <input
                    value={key}
                    onChange={e => setAction(key, e.target.value, val)}
                    placeholder="操作名"
                    className="w-20 px-2 py-1 rounded text-xs text-white"
                    style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                  />
                  <span className="text-gray-600">→</span>
                  <select
                    value={val}
                    onChange={e => setAction(key, key, e.target.value)}
                    className="flex-1 px-2 py-1 rounded text-xs text-white"
                    style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                  >
                    <option value="">-- 无 --</option>
                    {[...otherStepIds, 'done'].map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                  <button onClick={() => removeAction(key)} className="text-gray-600 hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
            {/* AI: 默认下一步（next，与 actions 共存） */}
            <div className="mt-3">
              <label className="block mb-1" style={{ color: '#4a5568' }}>默认下一步（next，可选）</label>
              <select
                value={form.next ?? ''}
                onChange={e => handleChange('next', e.target.value || undefined)}
                className="w-full px-2 py-1 rounded text-xs text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              >
                <option value="">-- 无 --</option>
                {[...otherStepIds, 'done'].map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
            {/* AI: Notify */}
            <div className="mt-2">
              <label className="block mb-1" style={{ color: '#4a5568' }}>Notify</label>
              <input
                value={form.notify ?? ''}
                onChange={e => handleChange('notify', e.target.value || undefined)}
                placeholder="mac_notification"
                className="w-full px-2 py-1 rounded text-xs text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              />
            </div>
          </section>
        )}

        {/* AI: parallel — after_all 汇聚节点 + 默认下一步 */}
        {stepType === 'parallel' && (
          <section>
            <div className="text-xs font-semibold mb-2" style={{ color: '#8892a4' }}>汇聚步骤（after_all）</div>
            <select
              value={form.after_all ?? ''}
              onChange={e => handleChange('after_all', e.target.value || undefined)}
              className="w-full px-2 py-1.5 rounded text-xs text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            >
              <option value="">-- 无 --</option>
              {otherStepIds.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </section>
        )}
      </div>

      {/* AI: 删除按钮 */}
      <div className="p-4 border-t" style={{ borderColor: '#2d3148' }}>
        <button
          onClick={handleDeleteStep}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs"
          style={{ color: '#fc8181', background: '#2d1515', border: '1px solid #5c2020' }}
        >
          <Trash2 size={12} />删除此步骤
        </button>
      </div>
    </div>
  )
}
/* AI end: 工作流节点配置侧边面板 */
