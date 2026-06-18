/* 布局组件 */
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { SidebarNav } from './SidebarNav'
import { ThemeInitializer } from './ThemeInitializer'

export function Layout() {
  const [showSettings, setShowSettings] = useState(false)

  const handleNewTask = () => {
    // TODO: 创建新任务
    console.log('New task')
  }

  return (
    <div className="flex h-screen bg-background text-text-primary overflow-hidden">
      <ThemeInitializer />
      
      {/* 侧边栏 */}
      <aside className="w-60 flex-shrink-0 border-r border-border">
        <SidebarNav
          onSettingsClick={() => setShowSettings(true)}
          onNewTaskClick={handleNewTask}
        />
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* 设置模态框 */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

// 简化版设置模态框
function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md p-6 bg-surface rounded-lg shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Settings</h2>
        <p className="text-text-secondary">Settings will be implemented soon.</p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
