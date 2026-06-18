import { Navigate, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { WelcomePage } from './components/WelcomePage';
import { ChatShell } from './components/ChatShell';
import { AutomationsPage } from './components/automations/AutomationsPage';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { ProjectDetailPage } from './components/projects/ProjectDetailPage';
import { KnowledgePage } from './components/KnowledgePage';
import { useScheduledTaskBootstrap } from './hooks/useScheduledTaskBootstrap';

export function App() {
  useScheduledTaskBootstrap();

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<WelcomePage />} />
        <Route path="t/:taskId" element={<ChatShell />} />
        <Route path="scheduled" element={<Navigate to="/automations/schedules" replace />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/:tab" element={<AutomationsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="knowledge/:collectionId" element={<KnowledgePage />} />
      </Route>
    </Routes>
  );
}
