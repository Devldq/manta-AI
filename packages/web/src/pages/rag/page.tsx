/* RAG 管理页 — /rag */
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Edit3, Database, Search, FileText,
  Loader2, RefreshCw, Upload, Download, Settings
} from 'lucide-react'

interface KnowledgeBase {
  id: string
  name: string
  description: string
  documentCount: number
  lastUpdated: string
  status: 'active' | 'inactive' | 'indexing'
}

export default function RAGPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newKBName, setNewKBName] = useState('')
  const [newKBDescription, setNewKBDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const loadKnowledgeBases = useCallback(async () => {
    try {
      // 模拟数据
      const mockData: KnowledgeBase[] = [
        {
          id: '1',
          name: 'Project Documentation',
          description: 'Technical documentation and API references',
          documentCount: 156,
          lastUpdated: '2024-01-15T10:30:00Z',
          status: 'active'
        },
        {
          id: '2',
          name: 'Code Examples',
          description: 'Code snippets and examples',
          documentCount: 89,
          lastUpdated: '2024-01-14T15:45:00Z',
          status: 'active'
        },
        {
          id: '3',
          name: 'User Guides',
          description: 'User manuals and guides',
          documentCount: 234,
          lastUpdated: '2024-01-13T09:20:00Z',
          status: 'indexing'
        }
      ]
      setKnowledgeBases(mockData)
    } catch (error) {
      console.error('Failed to load knowledge bases:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKnowledgeBases()
  }, [loadKnowledgeBases])

  const handleCreateKB = async () => {
    if (!newKBName.trim()) return

    setCreating(true)
    try {
      // 模拟创建
      const newKB: KnowledgeBase = {
        id: String(Date.now()),
        name: newKBName.trim(),
        description: newKBDescription.trim(),
        documentCount: 0,
        lastUpdated: new Date().toISOString(),
        status: 'active'
      }
      setKnowledgeBases(prev => [...prev, newKB])
      setShowCreateModal(false)
      setNewKBName('')
      setNewKBDescription('')
    } catch (error) {
      console.error('Failed to create knowledge base:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteKB = async (id: string) => {
    if (!confirm('确定删除此知识库？')) return

    try {
      setKnowledgeBases(prev => prev.filter(kb => kb.id !== id))
    } catch (error) {
      console.error('Failed to delete knowledge base:', error)
    }
  }

  const filteredKBs = knowledgeBases.filter(kb =>
    kb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    kb.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            RAG 知识库
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            管理检索增强生成知识库，提升 AI 回答质量
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-text-inverse transition-colors"
        >
          <Plus size={16} />
          创建知识库
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="搜索知识库..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* 知识库列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredKBs.map((kb) => (
          <div key={kb.id} className="bg-surface-elevated rounded-lg p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database size={20} className="text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">{kb.name}</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteKB(kb.id)}
                  className="p-1 hover:bg-surface rounded text-text-muted"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <p className="text-xs text-text-muted mb-3 line-clamp-2">{kb.description}</p>

            <div className="flex items-center justify-between text-xs text-text-muted">
              <div className="flex items-center gap-1">
                <FileText size={12} />
                <span>{kb.documentCount} 文档</span>
              </div>
              <span className={`px-2 py-1 rounded-full ${
                kb.status === 'active' ? 'bg-green-500/15 text-green-500' :
                kb.status === 'indexing' ? 'bg-yellow-500/15 text-yellow-500' :
                'bg-gray-500/15 text-gray-500'
              }`}>
                {kb.status === 'active' ? '活跃' : kb.status === 'indexing' ? '索引中' : '未激活'}
              </span>
            </div>

            <div className="mt-3 pt-3 border-t border-border-subtle">
              <p className="text-[11px] text-text-muted">
                更新于 {new Date(kb.lastUpdated).toLocaleDateString()}
              </p>
            </div>
          </div>
        ))}

        {filteredKBs.length === 0 && (
          <div className="col-span-full text-center py-12 text-text-muted">
            {searchQuery ? '未找到匹配的知识库' : '暂无知识库'}
          </div>
        )}
      </div>

      {/* 创建模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md p-6 bg-surface rounded-lg shadow-xl">
            <h2 className="text-lg font-semibold mb-4 text-text-primary">创建知识库</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">名称 *</label>
                <input
                  type="text"
                  value={newKBName}
                  onChange={(e) => setNewKBName(e.target.value)}
                  placeholder="知识库名称"
                  className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">描述</label>
                <textarea
                  value={newKBDescription}
                  onChange={(e) => setNewKBDescription(e.target.value)}
                  placeholder="知识库描述..."
                  rows={3}
                  className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:bg-surface-elevated rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateKB}
                disabled={creating || !newKBName.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : null}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
