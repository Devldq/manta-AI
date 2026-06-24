import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ThemeInitializer } from './components/ThemeInitializer'
import { SidebarNav } from './components/sidebar/SidebarNav'
import { MobileSidebarToggle } from './components/MobileSidebarToggle'
import { ApprovalDialog } from './components/ApprovalDialog'

// 页面组件（懒加载可后续优化）
import TasksPage from './pages/tasks/page'
import AppsPage from './pages/apps/page'
import AppDetailPage from './pages/apps/detail'
import AppBuilderPage from './pages/apps/builder'
import McpPage from './pages/mcp/page'
import SettingsPage from './pages/settings/page'
import WorkspacePage from './pages/workspace/page'
import WorkflowPage from './pages/workflow/page'
import ThemesPage from './pages/themes/page'
import RagPage from './pages/rag/page'
import EvaluationPage from './pages/evaluation/page'

/** 根布局 — 替代 Next.js 的 layout.tsx */
function AppLayout() {
  return (
    <div className="manta-main-container flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <SidebarNav />
      </div>
      <MobileSidebarToggle />
      <main className="flex-1 overflow-auto safe-area-bottom">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <>
      <ThemeInitializer />
      <ApprovalDialog />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/tasks" replace />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/:id" element={<AppDetailPage />} />
          <Route path="apps/:id/builder" element={<AppBuilderPage />} />
          <Route path="mcp" element={<McpPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="workflow" element={<WorkflowPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="rag" element={<RagPage />} />
          <Route path="evaluation" element={<EvaluationPage />} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Route>
      </Routes>
    </>
  )
}
