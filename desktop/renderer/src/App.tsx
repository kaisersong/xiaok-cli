import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { WelcomePage } from './components/WelcomePage';
import { ChatShell } from './components/ChatShell';
import { ScheduledPage } from './components/ScheduledPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<WelcomePage />} />
        <Route path="t/:taskId" element={<ChatShell />} />
        <Route path="scheduled" element={<ScheduledPage />} />
      </Route>
    </Routes>
  );
}
