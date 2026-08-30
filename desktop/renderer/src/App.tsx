import { Navigate, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { WelcomePage } from './components/WelcomePage';
import { ChatShell } from './components/ChatShell';
import { AutomationsPage } from './components/automations/AutomationsPage';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { ProjectDetailPage } from './components/projects/ProjectDetailPage';
import { KnowledgePage } from './components/KnowledgePage';
import { CollaborationRoomsPage } from './components/collaboration/CollaborationRoomsPage';
import { CollaborationRoomPage } from './components/collaboration/CollaborationRoomPage';
import { ScheduledTaskToast } from './components/ScheduledTaskToast';
import { useScheduledTaskBootstrap } from './hooks/useScheduledTaskBootstrap';

export function App() {
  useScheduledTaskBootstrap();

  return (
    <>
      <ScheduledTaskToast />
      <Routes>
        <Route path="meeting-recorder/:collectionId" element={<KnowledgePage />} />
        <Route element={<AppLayout />}>
          <Route index element={<WelcomePage />} />
          <Route path="t/:taskId" element={<ChatShell />} />
          <Route path="scheduled" element={<Navigate to="/automations/schedules" replace />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/:tab" element={<AutomationsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="collaboration" element={<CollaborationRoomsPage />} />
          <Route path="collaboration/:roomId" element={<CollaborationRoomPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="knowledge/:collectionId" element={<KnowledgePage />} />
        </Route>
      </Routes>
    </>
  );
}
