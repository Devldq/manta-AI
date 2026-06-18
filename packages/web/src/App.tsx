import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import TasksPage from './pages/tasks';
import AppsPage from './pages/apps/page';
import SettingsPage from './pages/settings/page';
import ThemesPage from './pages/themes/page';
import WorkspacePage from './pages/workspace/page';
import WorkflowPage from './pages/workflow/page';
import MCPServersPage from './pages/mcp/page';
import RAGPage from './pages/rag/page';
import EvaluationPage from './pages/evaluation/page';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<TasksPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="workflow" element={<WorkflowPage />} />
          <Route path="mcp" element={<MCPServersPage />} />
          <Route path="rag" element={<RAGPage />} />
          <Route path="evaluation" element={<EvaluationPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
