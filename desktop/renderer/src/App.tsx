import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { WelcomePage } from './components/WelcomePage';
import { ChatShell } from './components/ChatShell';
import { ScheduledPage } from './components/ScheduledPage';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { ProjectDetailPage } from './components/projects/ProjectDetailPage';
import { useScheduledTaskBootstrap } from './hooks/useScheduledTaskBootstrap';

export function App() {
  useScheduledTaskBootstrap();

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<WelcomePage />} />
        <Route path="t/:taskId" element={<ChatShell />} />
        <Route path="scheduled" element={<ScheduledPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
      </Route>
    </Routes>
  );
}
