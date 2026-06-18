/* 设置模态框组件 */
import { useState, useEffect } from 'react'
import { X, Check, Loader2 } from 'lucide-react'

interface SettingsModalProps {
  onClose: () => void
}

interface LLMConfig {
  openaiKey: string
  anthropicKey: string
  defaultProvider: 'openai' | 'anthropic'
  defaultModel: string
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'llm' | 'storage' | 'plugins'>('general')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    openaiKey: '',
    anthropicKey: '',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o'
  })

  useEffect(() => {
    // 从本地存储加载配置
    const stored = localStorage.getItem('manta:settings')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed.llm) {
          setLlmConfig(prev => ({ ...prev, ...parsed.llm }))
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }, [])

  const handleSave = () => {
    setLoading(true)
    // 保存到本地存储
    const settings = {
      llm: llmConfig
    }
    localStorage.setItem('manta:settings', JSON.stringify(settings))
    setTimeout(() => {
      setLoading(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, 500)
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'llm', label: 'LLM' },
    { id: 'storage', label: 'Storage' },
    { id: 'plugins', label: 'Plugins' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[80vh] bg-surface rounded-lg shadow-xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-elevated rounded-md transition-colors"
          >
            <X size={20} className="text-text-secondary" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 侧边标签 */}
          <div className="w-48 border-r border-border-subtle p-2 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full px-3 py-2 rounded-md text-left text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-elevated'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 内容区域 */}
          <div className="flex-1 p-6 overflow-auto">
            {activeTab === 'general' && (
              <GeneralSettings />
            )}
            {activeTab === 'llm' && (
              <LLMSettings config={llmConfig} onChange={setLlmConfig} />
            )}
            {activeTab === 'storage' && (
              <StorageSettings />
            )}
            {activeTab === 'plugins' && (
              <PluginSettings />
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border-subtle">
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-500">
              <Check size={16} />
              Saved
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:bg-surface-elevated rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function GeneralSettings() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-text-primary">General Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            App Name
          </label>
          <input
            type="text"
            defaultValue="Manta AI"
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Color Mode
          </label>
          <select className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Language
          </label>
          <select className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function LLMSettings({ config, onChange }: { config: LLMConfig; onChange: (config: LLMConfig) => void }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-text-primary">LLM Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            OpenAI API Key
          </label>
          <input
            type="password"
            value={config.openaiKey}
            onChange={(e) => onChange({ ...config, openaiKey: e.target.value })}
            placeholder="sk-..."
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Anthropic API Key
          </label>
          <input
            type="password"
            value={config.anthropicKey}
            onChange={(e) => onChange({ ...config, anthropicKey: e.target.value })}
            placeholder="sk-ant-..."
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Default Provider
          </label>
          <select
            value={config.defaultProvider}
            onChange={(e) => onChange({ ...config, defaultProvider: e.target.value as 'openai' | 'anthropic' })}
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Default Model
          </label>
          <select
            value={config.defaultModel}
            onChange={(e) => onChange({ ...config, defaultModel: e.target.value })}
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {config.defaultProvider === 'openai' ? (
              <>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
              </>
            ) : (
              <>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              </>
            )}
          </select>
        </div>
      </div>
    </div>
  )
}

function StorageSettings() {
  const [storagePath, setStoragePath] = useState('~/.manta-data')

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-text-primary">Storage Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Storage Path
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={storagePath}
              onChange={(e) => setStoragePath(e.target.value)}
              className="flex-1 px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button className="px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors">
              Browse
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between p-3 bg-surface-elevated rounded-md">
          <div>
            <p className="text-sm font-medium text-text-primary">Auto Backup</p>
            <p className="text-xs text-text-muted">Backup data every 24 hours</p>
          </div>
          <button className="w-10 h-6 bg-accent rounded-full relative">
            <div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1" />
          </button>
        </div>
      </div>
    </div>
  )
}

function PluginSettings() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-text-primary">Plugin Settings</h3>
      <div className="space-y-4">
        <div className="p-4 border border-border-subtle rounded-lg">
          <h4 className="font-medium text-text-primary">Web Search</h4>
          <p className="text-sm text-text-secondary mt-1">Enable web search capabilities</p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-sm text-text-muted">Status: Enabled</span>
            <button className="px-3 py-1.5 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors">
              Configure
            </button>
          </div>
        </div>
        <div className="p-4 border border-border-subtle rounded-lg">
          <h4 className="font-medium text-text-primary">Code Interpreter</h4>
          <p className="text-sm text-text-secondary mt-1">Execute code snippets safely</p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-sm text-text-muted">Status: Disabled</span>
            <button className="px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-sm transition-colors">
              Enable
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
