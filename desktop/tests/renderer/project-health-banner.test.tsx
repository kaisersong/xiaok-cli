import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockDeleteProject } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockDeleteProject: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    connected: true,
    agents: [],
    getProjectFullDetail: mockGetProjectFullDetail,
    approveProject: vi.fn(),
    retryPlan: vi.fn(),
    dispatchTasks: vi.fn(),
    deliverProject: vi.fn(),
    closeProject: vi.fn(),
    deleteProject: mockDeleteProject,
  }),
}));

vi.mock('../../renderer/src/components/projects/KanbanBoard', () => ({
  KanbanBoard: () => <div>kanban</div>,
}));
vi.mock('../../renderer/src/components/projects/PlanView', () => ({
  PlanView: () => <div>plan</div>,
}));
vi.mock('../../renderer/src/components/projects/ActivityTimeline', () => ({
  ActivityTimeline: () => <div>activity</div>,
}));
vi.mock('../../renderer/src/components/projects/DeliverableView', () => ({
  DeliverableView: () => <div>deliverables</div>,
}));

import { ProjectCard } from '../../renderer/src/components/projects/ProjectCard';
import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { ProjectProgressCard } from '../../renderer/src/components/projects/ProjectProgressCard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function loadFixture(name: string): ProjectFullDetail {
  const path = join(process.cwd(), '..', 'tests', 'fixtures', 'kswarm', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ProjectFullDetail;
}

function renderWithProviders(ui: React.ReactNode, initialPath = '/') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </LocaleProvider>
  );
}

describe('project health status UI', () => {
  it('renders a blocked project health banner with primary task and recommended action', async () => {
    const detail = loadFixture('full-detail-blocked-project.json');
    mockGetProjectFullDetail.mockResolvedValue(detail);

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      `/projects/${detail.project.id}`
    );

    await waitFor(() => expect(screen.getByText('项目阻塞')).toBeInTheDocument());
    expect(screen.getByText(/结构评审缺少证据/)).toBeInTheDocument();
    expect(screen.getByText(/item-6/)).toBeInTheDocument();
    expect(screen.getByText('诊断')).toBeInTheDocument();
    expect(screen.getByText('派发未阻塞任务')).toBeInTheDocument();
  });

  it('shows project health on project list cards', () => {
    renderWithProviders(
      <ProjectCard
        project={{
          id: 'proj-1',
          name: '技术大会演讲报告',
          status: 'active',
          taskCount: 4,
          doneCount: 1,
          projectHealth: {
            status: 'failed',
            message: '最终校验失败',
            primaryBlockedTaskId: 'item-8',
          },
        }}
      />
    );

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText(/最终校验失败/)).toBeInTheDocument();
  });

  it('shows dispatch plan counters on inline project progress cards', () => {
    renderWithProviders(
      <ProjectProgressCard
        project={{
          id: 'proj-1',
          name: '技术大会演讲报告',
          status: 'active',
          taskCount: 4,
          doneCount: 1,
          dispatchPlan: {
            dispatchable: [{ taskId: 'item-7' }],
            blocked: [{ taskId: 'item-6', reason: 'missing_review_evidence' }],
            waiting: [{ taskId: 'item-8', reason: 'quality_retry_required' }],
          },
          projectHealth: {
            status: 'blocked',
            message: '结构评审缺少证据',
          },
        }}
      />
    );

    expect(screen.getByText('阻塞')).toBeInTheDocument();
    expect(screen.getByText('可派发 1')).toBeInTheDocument();
    expect(screen.getByText('阻塞 1')).toBeInTheDocument();
    expect(screen.getByText('等待 1')).toBeInTheDocument();
  });
});
