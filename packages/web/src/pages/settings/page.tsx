/* 设置页 — /settings */
import { useState } from 'react'
import { Settings, User, Bell, Shield, Palette, Database, Globe, Save } from 'lucide-react'

interface SettingsSection {
  id: string
  label: string
  icon: React.ReactNode
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('profile')
  const [saving, setSaving] = useState(false)

  const sections: SettingsSection[] = [
    { id: 'profile', label: 'Profile', icon: <User size={18} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> },
    { id: 'security', label: 'Security', icon: <Shield size={18} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
    { id: 'data', label: 'Data & Storage', icon: <Database size={18} /> },
    { id: 'api', label: 'API & Integrations', icon: <Globe size={18} /> },
  ]

  const handleSave = async () => {
    setSaving(true)
    // 模拟保存
    await new Promise(resolve => setTimeout(resolve, 1000))
    setSaving(false)
  }

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto">
        {/* 顶部标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
            <p className="text-text-secondary mt-1">Manage your account and preferences</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={18} />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>

        <div className="flex gap-6">
          {/* 侧边栏导航 */}
          <div className="w-48 flex-shrink-0">
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
                    activeSection === section.id
                      ? 'bg-accent text-text-inverse'
                      : 'text-text-secondary hover:bg-surface-elevated'
                  }`}
                >
                  {section.icon}
                  <span className="text-sm">{section.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* 设置内容 */}
          <div className="flex-1">
            <div className="bg-surface-elevated rounded-lg p-6 border border-border">
              {activeSection === 'profile' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">Profile Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Display Name</label>
                      <input
                        type="text"
                        defaultValue="Manta User"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
                      <input
                        type="email"
                        defaultValue="user@example.com"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Bio</label>
                      <textarea
                        defaultValue="AI enthusiast and developer"
                        rows={3}
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'notifications' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">Notification Preferences</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text-primary">Email Notifications</p>
                        <p className="text-sm text-text-secondary">Receive email updates</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked className="sr-only peer" />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text-primary">Push Notifications</p>
                        <p className="text-sm text-text-secondary">Receive push notifications</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'security' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">Security Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Current Password</label>
                      <input
                        type="password"
                        placeholder="Enter current password"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">New Password</label>
                      <input
                        type="password"
                        placeholder="Enter new password"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        placeholder="Confirm new password"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'appearance' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">Appearance Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Theme</label>
                      <div className="grid grid-cols-3 gap-3">
                        {['Light', 'Dark', 'System'].map((theme) => (
                          <button
                            key={theme}
                            className="px-4 py-2 bg-surface rounded-lg text-text-primary hover:bg-accent hover:text-text-inverse transition-colors"
                          >
                            {theme}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Font Size</label>
                      <select className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
                        <option>Small</option>
                        <option>Medium</option>
                        <option>Large</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'data' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">Data & Storage</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-surface rounded-lg">
                      <div>
                        <p className="font-medium text-text-primary">Local Storage</p>
                        <p className="text-sm text-text-secondary">2.4 GB used</p>
                      </div>
                      <button className="px-3 py-1.5 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors">
                        Clear Data
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-surface rounded-lg">
                      <div>
                        <p className="font-medium text-text-primary">Cache</p>
                        <p className="text-sm text-text-secondary">156 MB</p>
                      </div>
                      <button className="px-3 py-1.5 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors">
                        Clear Cache
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'api' && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">API & Integrations</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">API Key</label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          defaultValue="sk-1234567890abcdef"
                          className="flex-1 px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        <button className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg transition-colors">
                          Copy
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Webhook URL</label>
                      <input
                        type="url"
                        placeholder="https://example.com/webhook"
                        className="w-full px-3 py-2 bg-surface rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
