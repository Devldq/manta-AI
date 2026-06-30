/* Skill 技能管理页 — /skills
 *
 * 功能：
 * - Skill CRUD（创建/编辑/删除/启禁用）
 * - 扫描 skills/ 目录导入 SKILL.md
 * - Agent 绑定/解绑管理
 * - Skill 详情展开查看
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Zap,
  BookOpen,
  Wrench,
  Workflow,
  XCircle,
  ChevronDown,
  Loader2,
  Eye,
  EyeOff,
  Search,
  Download,
  Upload,
  Bot,
  Link2,
  Unlink2,
  Check,
  FileSearch,
} from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────────────────────────

type SkillType = 'writing' | 'tool' | 'workflow';

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  version?: string;
  source?: string;
  enabled: boolean;
  boundAgents?: string[];
  createdAt: string;
  updatedAt: string;
}

interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

interface SkillDefinition extends SkillSummary {
  metadata: {
    name: string;
    description: string;
    version?: string;
    type: SkillType;
    source?: string;
    license?: string;
    userInvocable?: boolean;
    argumentHint?: string;
  };
  content: string;
  parameters?: SkillParameter[];
  tools?: string[];
  filePath?: string;
}

interface SkillFormData {
  name: string;
  description: string;
  version: string;
  type: SkillType;
  content: string;
  license: string;
  userInvocable: boolean;
  argumentHint: string;
  parameters: SkillParameter[];
  tools: string;
}

interface AgentRef {
  name: string;
  label: string;
  enabled: boolean;
}

interface ScannedSkillItem {
  name: string;
  description: string;
  version?: string;
  type: SkillType;
  dirName: string;
  alreadyImported: boolean;
}

// ── API 辅助 ──────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || '请求失败');
  return data;
}

// ── 常量 ──────────────────────────────────────────────────────────────────

const emptyForm: SkillFormData = {
  name: '',
  description: '',
  version: '1.0.0',
  type: 'tool',
  content: '',
  license: 'MIT',
  userInvocable: true,
  argumentHint: '',
  parameters: [],
  tools: '',
};

// ── 工具函数 ──────────────────────────────────────────────────────────────

function SkillTypeIcon({ type, size = 18 }: { type: SkillType; size?: number }) {
  const s = { color: 'var(--color-accent)' };
  switch (type) {
    case 'writing':
      return <BookOpen size={size} style={s} />;
    case 'tool':
      return <Wrench size={size} style={s} />;
    case 'workflow':
      return <Workflow size={size} style={s} />;
    default:
      return <Zap size={size} style={s} />;
  }
}

function SkillTypeLabel({ type }: { type: SkillType }) {
  switch (type) {
    case 'writing': return '写作类';
    case 'tool': return '工具类';
    case 'workflow': return '流程类';
    default: return type;
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── 页面主体 ──────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 表单 modal
  const [showModal, setShowModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [form, setForm] = useState<SkillFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // 展开详情
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDefinition | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 扫描导入 modal
  const [showScanModal, setShowScanModal] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedSkillItem[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Agent 绑定 modal
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindSkillId, setBindSkillId] = useState<string | null>(null);
  const [bindSkillName, setBindSkillName] = useState('');
  const [allAgents, setAllAgents] = useState<AgentRef[]>([]);
  const [boundAgents, setBoundAgents] = useState<string[]>([]);
  const [bindLoading, setBindLoading] = useState(false);

  // ═══ 数据加载 ══════════════════════════════════════════════════════════

  const loadSkills = useCallback(async () => {
    try {
      setError('');
      const data = await apiFetch<{ data: { skills: SkillSummary[] } }>('/api/skills');
      setSkills(data.data?.skills || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<{ data: { skill: SkillDefinition } }>(`/api/skills/${id}`);
      setSkillDetail(data.data?.skill || null);
    } catch {
      setSkillDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function toggleExpand(id: string) {
    if (expandedSkill === id) {
      setExpandedSkill(null);
      setSkillDetail(null);
    } else {
      setExpandedSkill(id);
      fetchDetail(id);
    }
  }

  // ═══ CRUD 表单 ══════════════════════════════════════════════════════════

  function openCreateModal() {
    setEditingSkill(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  }

  function openEditModal(skill: SkillSummary) {
    setEditingSkill(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      type: skill.type,
      content: '',
      license: 'MIT',
      userInvocable: true,
      argumentHint: '',
      parameters: [],
      tools: '',
    });
    fetch(`/api/skills/${skill.id}`)
      .then((r) => r.json())
      .then((data) => {
        const def = data.data?.skill;
        if (def) {
          setForm({
            name: def.metadata?.name || skill.name,
            description: def.metadata?.description || skill.description,
            version: def.metadata?.version || '1.0.0',
            type: def.metadata?.type || skill.type,
            content: def.content || '',
            license: def.metadata?.license || 'MIT',
            userInvocable: def.metadata?.userInvocable ?? true,
            argumentHint: def.metadata?.argumentHint || '',
            parameters: def.parameters || [],
            tools: (def.tools || []).join('\n'),
          });
        }
      })
      .catch(() => {});
    setFormError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingSkill(null);
    setForm(emptyForm);
    setFormError('');
  }

  function validateForm(): boolean {
    if (!form.name.trim()) { setFormError('名称不能为空'); return false; }
    if (!form.description.trim()) { setFormError('描述不能为空'); return false; }
    if (!form.content.trim()) { setFormError('指令内容不能为空'); return false; }
    return true;
  }

  async function handleSubmit() {
    if (!validateForm()) return;
    setSubmitting(true);
    setFormError('');

    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        version: form.version.trim() || '1.0.0',
        type: form.type,
        content: form.content.trim(),
        license: form.license.trim(),
        userInvocable: form.userInvocable,
        argumentHint: form.argumentHint.trim(),
        parameters: form.parameters,
        tools: form.tools.split('\n').map((t) => t.trim()).filter(Boolean),
      };

      if (editingSkill) {
        await apiFetch(`/api/skills/${editingSkill}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeModal();
      await loadSkills();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除 Skill "${name}"？此操作不可逆。`)) return;
    try {
      await apiFetch(`/api/skills/${id}`, { method: 'DELETE' });
      await loadSkills();
      if (expandedSkill === id) { setExpandedSkill(null); setSkillDetail(null); }
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleToggleEnabled(id: string, enabled: boolean) {
    try {
      await apiFetch(`/api/skills/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      await loadSkills();
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ═══ 扫描导入 ══════════════════════════════════════════════════════════

  async function openScanModal() {
    setShowScanModal(true);
    setScanLoading(true);
    setScanError('');
    setSelectedForImport(new Set());
    try {
      const data = await apiFetch<{ data: { scanned: ScannedSkillItem[]; baseDir: string; total: number; newCount: number; importedCount: number } }>(
        '/api/skills/scan',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const scanned = data.data?.scanned || [];
      setScannedItems(scanned);
      // 默认选中所有未导入的
      setSelectedForImport(new Set(
        scanned.filter((s) => !s.alreadyImported).map((s) => s.name),
      ));
      if (scanned.length === 0) setScanError('未在 skills/ 目录中找到任何 SKILL.md 文件');
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setScanLoading(false);
    }
  }

  function toggleSelectForImport(name: string) {
    const next = new Set(selectedForImport);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedForImport(next);
  }

  function selectAllForImport() {
    const newNames = scannedItems.filter((s) => !s.alreadyImported).map((s) => s.name);
    setSelectedForImport(new Set(newNames));
  }

  async function handleImport() {
    if (selectedForImport.size === 0) return;
    setImporting(true);
    try {
      await apiFetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [...selectedForImport], overwrite: false }),
      });
      setShowScanModal(false);
      await loadSkills();
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setImporting(false);
    }
  }

  // ═══ Agent 绑定 ════════════════════════════════════════════════════════

  async function openBindModal(skill: SkillSummary) {
    setBindSkillId(skill.id);
    setBindSkillName(skill.name);
    setBoundAgents(skill.boundAgents || []);
    setShowBindModal(true);
    setBindLoading(true);

    try {
      // 获取所有 Agent
      const data = await apiFetch<{ agents: AgentRef[] }>('/api/agents/names');
      setAllAgents(data.agents || []);
    } catch (e: any) {
      alert('获取 Agent 列表失败: ' + e.message);
    } finally {
      setBindLoading(false);
    }
  }

  function isAgentBound(name: string) {
    return boundAgents.includes(name);
  }

  async function toggleBindAgent(agentName: string) {
    if (!bindSkillId) return;
    try {
      if (boundAgents.includes(agentName)) {
        // 解绑
        await apiFetch(`/api/skills/${bindSkillId}/bind`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName }),
        });
        setBoundAgents((prev) => prev.filter((a) => a !== agentName));
      } else {
        // 绑定
        const newList = [...boundAgents, agentName];
        await apiFetch(`/api/skills/${bindSkillId}/bind`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentNames: newList }),
        });
        setBoundAgents(newList);
      }
      await loadSkills();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function closeBindModal() {
    setShowBindModal(false);
    setBindSkillId(null);
  }

  // ═══ 渲染 ══════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Skill 技能
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理 Agent 的可复用能力模块 · 从 skills/ 目录同步 Skill 定义
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openScanModal}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors"
            style={{
              color: 'var(--color-text-secondary)',
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
            }}
            title="扫描 skills/ 目录导入 SKILL.md"
          >
            <FileSearch size={14} />
            扫描导入
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
          >
            <Plus size={16} />
            创建 Skill
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
          <button onClick={loadSkills} className="ml-3 underline" style={{ color: '#ef4444' }}>重试</button>
        </div>
      )}

      {/* 空状态 */}
      {skills.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}>
          <Zap size={48} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚未创建任何 Skill</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
            你可以手动创建，或从 skills/ 目录扫描导入 SKILL.md 文件
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
            >
              <Plus size={16} /> 创建第一个 Skill
            </button>
            <button
              onClick={openScanModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
              style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <FileSearch size={16} /> 扫描导入
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              detail={expandedSkill === skill.id ? skillDetail : null}
              detailLoading={expandedSkill === skill.id ? detailLoading : false}
              expanded={expandedSkill === skill.id}
              onToggleExpand={() => toggleExpand(skill.id)}
              onEdit={() => openEditModal(skill)}
              onDelete={() => handleDelete(skill.id, skill.name)}
              onToggleEnabled={() => handleToggleEnabled(skill.id, skill.enabled)}
              onBindAgents={() => openBindModal(skill)}
            />
          ))}
        </div>
      )}

      {/* 表单 Modal */}
      {showModal && (
        <SkillFormModal form={form} setForm={setForm} isEditing={!!editingSkill} submitting={submitting} error={formError} onSubmit={handleSubmit} onClose={closeModal} />
      )}

      {/* 扫描导入 Modal */}
      {showScanModal && (
        <ScanImportModal
          items={scannedItems}
          selected={selectedForImport}
          loading={scanLoading}
          importing={importing}
          error={scanError}
          onToggle={toggleSelectForImport}
          onSelectAll={selectAllForImport}
          onImport={handleImport}
          onClose={() => setShowScanModal(false)}
        />
      )}

      {/* Agent 绑定 Modal */}
      {showBindModal && (
        <BindAgentsModal
          skillName={bindSkillName}
          agents={allAgents}
          boundAgents={boundAgents}
          loading={bindLoading}
          onToggle={toggleBindAgent}
          onClose={closeBindModal}
        />
      )}
    </div>
  );
}

// ── Skill 卡片 ────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  detail,
  detailLoading,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleEnabled,
  onBindAgents,
}: {
  skill: SkillSummary;
  detail: SkillDefinition | null;
  detailLoading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onBindAgents: () => void;
}) {
  return (
    <div className="rounded-xl border transition-colors" style={{ borderColor: 'var(--color-border)', background: skill.enabled ? 'var(--color-background)' : 'var(--color-surface)', opacity: skill.enabled ? 1 : 0.6 }}>
      <div className="flex items-center gap-4 p-4">
        <button onClick={onToggleExpand} className="flex-shrink-0 p-1 rounded transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
          <SkillTypeIcon type={skill.type} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{skill.name}</h3>
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}>
              <SkillTypeLabel type={skill.type} />
            </span>
            {skill.version && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>v{skill.version}</span>}
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>{skill.description}</p>

          {/* 绑定的 Agents */}
          {skill.boundAgents && skill.boundAgents.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {skill.boundAgents.slice(0, 3).map((a) => (
                <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  {a}
                </span>
              ))}
              {skill.boundAgents.length > 3 && (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>+{skill.boundAgents.length - 3}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          {skill.enabled ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
              <Eye size={12} /> 启用
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
              <EyeOff size={12} /> 禁用
            </span>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-1">
          {/* 绑定按钮 */}
          <button onClick={onBindAgents} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-muted)' }} title="管理 Agent 绑定">
            <Link2 size={16} />
          </button>
          <button onClick={onEdit} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-muted)' }} title="编辑">
            <Edit3 size={16} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10" style={{ color: 'var(--color-text-muted)' }} title="删除">
            <Trash2 size={16} />
          </button>
          <button onClick={onToggleEnabled} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-muted)' }} title={skill.enabled ? '禁用' : '启用'}>
            <XCircle size={16} />
          </button>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 border-t mx-4" style={{ borderColor: 'var(--color-border)' }}>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            </div>
          ) : detail ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <DetailItem label="名称" value={detail.metadata.name} />
                <DetailItem label="类型" value={<SkillTypeLabel type={detail.metadata.type} />} />
                <DetailItem label="版本" value={detail.metadata.version || '-'} />
                <DetailItem label="来源" value={detail.metadata.source || 'user'} />
                <DetailItem label="许可" value={detail.metadata.license || '-'} />
                <DetailItem label="用户可调用" value={detail.metadata.userInvocable ? '是' : '否'} />
                <DetailItem label="创建时间" value={formatDate(detail.createdAt)} />
                <DetailItem label="更新时间" value={formatDate(detail.updatedAt)} />
              </div>

              {detail.metadata.argumentHint && (
                <DetailItem label="参数提示" value={detail.metadata.argumentHint} />
              )}

              <div>
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>指令内容</span>
                <pre className="mt-1 p-3 rounded-lg text-xs overflow-auto max-h-48 font-mono" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {detail.content.slice(0, 500)}{detail.content.length > 500 && '\n... (截断)'}
                </pre>
              </div>

              {detail.parameters && detail.parameters.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>参数 ({detail.parameters.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.parameters.map((p: SkillParameter) => (
                      <span key={p.name} className="text-[10px] px-1.5 py-0.5 font-mono rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        {p.name}: {p.type}{p.required ? '*' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.tools && detail.tools.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>关联工具 ({detail.tools.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.tools.map((t: string) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 font-mono rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.boundAgents && detail.boundAgents.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>绑定 Agent ({detail.boundAgents.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.boundAgents.map((a: string) => (
                      <span key={a} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.2)' }}>
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs py-4" style={{ color: 'var(--color-text-muted)' }}>加载详情失败</p>
          )}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
    </div>
  );
}

// ── 扫描导入 Modal ───────────────────────────────────────────────────────

function ScanImportModal({
  items, selected, loading, importing, error,
  onToggle, onSelectAll, onImport, onClose,
}: {
  items: ScannedSkillItem[];
  selected: Set<string>;
  loading: boolean;
  importing: boolean;
  error: string;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const newItems = items.filter((s) => !s.alreadyImported);
  const importedItems = items.filter((s) => s.alreadyImported);

  if (loading) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalBox title="扫描 Skill 文件" onClose={onClose} maxHeight>
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            <span className="ml-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>正在扫描 skills/ 目录...</span>
          </div>
        </ModalBox>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalBox title="扫描导入 Skill" onClose={onClose} maxHeight>
        {error && (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-8">
            <FileSearch size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>未找到任何 SKILL.md 文件</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              请在项目的 skills/ 目录中添加 SKILL.md 文件
            </p>
          </div>
        ) : (
          <>
            {/* 新 Skill（可导入） */}
            {newItems.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    可导入 ({newItems.length})
                  </span>
                  <button onClick={onSelectAll} className="text-xs underline" style={{ color: 'var(--color-accent)' }}>
                    全选
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {newItems.map((item) => (
                    <ScanItemRow
                      key={item.name}
                      item={item}
                      checked={selected.has(item.name)}
                      onToggle={() => onToggle(item.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 已导入 Skill */}
            {importedItems.length > 0 && (
              <div className="mb-4">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  已导入 ({importedItems.length})
                </span>
                <div className="space-y-2 mt-2 max-h-32 overflow-y-auto">
                  {importedItems.map((item) => (
                    <ScanItemRow key={item.name} item={item} checked={false} disabled onToggle={() => {}} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}>
                取消
              </button>
              <button
                onClick={onImport}
                disabled={selected.size === 0 || importing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
              >
                {importing ? <><Loader2 size={14} className="animate-spin" /> 导入中...</> : <><Download size={14} /> 导入选中 ({selected.size})</>}
              </button>
            </div>
          </>
        )}
      </ModalBox>
    </ModalOverlay>
  );
}

function ScanItemRow({
  item, checked, disabled, onToggle,
}: {
  item: ScannedSkillItem;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 rounded"
        style={{ accentColor: 'var(--color-accent)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold font-mono" style={{ color: 'var(--color-text-primary)' }}>{item.name}</span>
          <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-accent)' }}>
            <SkillTypeLabel type={item.type} />
          </span>
        </div>
        <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.description.slice(0, 80)}</p>
        {item.version && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>v{item.version} · {item.dirName}/</span>}
      </div>
      {disabled && (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
          <Check size={12} className="inline" /> 已导入
        </span>
      )}
    </label>
  );
}

// ── Agent 绑定 Modal ─────────────────────────────────────────────────────

function BindAgentsModal({
  skillName, agents, boundAgents, loading, onToggle, onClose,
}: {
  skillName: string;
  agents: AgentRef[];
  boundAgents: string[];
  loading: boolean;
  onToggle: (agentName: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents;

  const boundList = filtered.filter((a) => boundAgents.includes(a.name));
  const unboundList = filtered.filter((a) => !boundAgents.includes(a.name));

  if (loading) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalBox title={`绑定 Agent — ${skillName}`} onClose={onClose} maxHeight>
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>加载 Agent 列表...</span>
          </div>
        </ModalBox>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalBox title={`管理 Agent 绑定 — ${skillName}`} onClose={onClose} maxHeight>
        {/* 搜索框 */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Agent..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none transition-colors"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          />
        </div>

        {/* 已绑定 */}
        {boundList.length > 0 && (
          <div className="mb-3">
            <span className="text-[10px] font-medium" style={{ color: 'var(--color-accent)' }}>已绑定 ({boundList.length})</span>
            <div className="mt-1.5 space-y-1">
              {boundList.map((a) => (
                <AgentBindRow key={a.name} agent={a} bound onToggle={() => onToggle(a.name)} />
              ))}
            </div>
          </div>
        )}

        {/* 未绑定 */}
        {unboundList.length > 0 && (
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>可绑定 ({unboundList.length})</span>
            <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
              {unboundList.map((a) => (
                <AgentBindRow key={a.name} agent={a} bound={false} onToggle={() => onToggle(a.name)} />
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p className="text-center py-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {search ? `未找到匹配 "${search}" 的 Agent` : '暂无可用 Agent'}
          </p>
        )}

        <div className="flex justify-end pt-3 border-t mt-3" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg transition-colors" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            完成
          </button>
        </div>
      </ModalBox>
    </ModalOverlay>
  );
}

function AgentBindRow({
  agent, bound, onToggle,
}: {
  agent: AgentRef;
  bound: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        <Bot size={14} style={{ color: bound ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
        <span className="text-xs font-mono" style={{ color: 'var(--color-text-primary)' }}>{agent.name}</span>
        {!agent.enabled && (
          <span className="text-[10px] px-1 rounded" style={{ color: 'var(--color-text-muted)', background: 'var(--color-background)' }}>已禁用</span>
        )}
      </div>
      {bound ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>
          <Unlink2 size={10} /> 解绑
        </span>
      ) : (
        <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ color: 'var(--color-accent)', background: 'rgba(99,102,241,0.1)' }}>
          <Link2 size={10} /> 绑定
        </span>
      )}
    </div>
  );
}

// ── 表单 Modal ────────────────────────────────────────────────────────────

function SkillFormModal({
  form, setForm, isEditing, submitting, error, onSubmit, onClose,
}: {
  form: SkillFormData;
  setForm: (f: SkillFormData) => void;
  isEditing: boolean;
  submitting: boolean;
  error: string;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const update = (patch: Partial<SkillFormData>) => setForm({ ...form, ...patch });

  return (
    <ModalOverlay onClose={onClose}>
      <div className="rounded-xl border shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto" style={{ background: 'var(--color-background)', borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{isEditing ? '编辑 Skill' : '创建 Skill'}</h2>
          <button onClick={onClose} className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-muted)' }}><XCircle size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>名称 *</label>
            <input type="text" value={form.name} onChange={(e) => update({ name: e.target.value })} disabled={isEditing}
              placeholder="例如: generate-weekly-report"
              className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            />
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>小写字母+数字+连字符，如 analyze-sales-data</span>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>描述 * (决定 Agent 何时调用此 Skill)</label>
            <textarea value={form.description} onChange={(e) => update({ description: e.target.value })}
              placeholder="说明功能、触发场景、输入输出格式。例如：从Excel文件读取销售数据，按产品类别聚合，生成包含环比增长的可视化报表。当用户需要月度业务分析时使用。"
              rows={3} className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none resize-none transition-colors"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>类型 *</label>
              <div className="flex gap-2">
                {(['writing', 'tool', 'workflow'] as const).map((t) => (
                  <button key={t} onClick={() => update({ type: t })}
                    className="flex-1 px-2 py-1.5 text-xs rounded-lg border transition-colors"
                    style={{
                      background: form.type === t ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: form.type === t ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                      borderColor: form.type === t ? 'var(--color-accent)' : 'var(--color-border)',
                    }}
                  ><SkillTypeLabel type={t} /></button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>版本</label>
              <input type="text" value={form.version} onChange={(e) => update({ version: e.target.value })}
                placeholder="1.0.0"
                className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>指令内容 * (Markdown，≤500行)</label>
            <textarea value={form.content} onChange={(e) => update({ content: e.target.value })}
              placeholder={`# 任务目标\n生成大厂早报文章，覆盖互联网头部企业核心动态`}
              rows={12} className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono resize-none transition-colors"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>关联工具 (每行一个工具名)</label>
            <textarea value={form.tools} onChange={(e) => update({ tools: e.target.value })}
              placeholder="web_search\nread_file\nexecute_command"
              rows={4} className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono resize-none transition-colors"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>参数提示 (可选)</label>
            <input type="text" value={form.argumentHint} onChange={(e) => update({ argumentHint: e.target.value })}
              placeholder="[craft|audit|polish] [target]"
              className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>用户可手动调用</span>
            <button onClick={() => update({ userInvocable: !form.userInvocable })}
              className="relative w-9 h-5 rounded-full transition-colors"
              style={{ background: form.userInvocable ? 'var(--color-accent)' : 'var(--color-border)' }}
            >
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: form.userInvocable ? 'calc(100% - 1.125rem)' : '0.125rem' }}
              />
            </button>
          </div>

          {error && (
            <p className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-xs rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}>取消</button>
          <button onClick={onSubmit} disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
          >
            {submitting ? <><Loader2 size={14} className="animate-spin" /> 提交中...</> : isEditing ? '保存修改' : '创建 Skill'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── 通用 Modal 组件 ──────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 flex items-start justify-center z-50 pt-[10vh]"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

function ModalBox({
  title, children, onClose, maxHeight,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  maxHeight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border shadow-2xl w-full max-w-lg ${maxHeight ? 'max-h-[80vh] overflow-y-auto' : ''}`}
      style={{ background: 'var(--color-background)', borderColor: 'var(--color-border)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
        <button onClick={onClose} className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-muted)' }}>
          <XCircle size={18} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
