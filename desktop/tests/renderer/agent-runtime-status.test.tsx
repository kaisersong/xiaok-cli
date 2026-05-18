import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => {
    const detail = mockGetProjectFullDetail.mock.results.at(-1)?.value;
    return {
      connected: true,
      agents: [
        { id: 'po-agent', name: 'PO', status: 'waiting' },
        { id: 'cli-claude', name: 'Claude CLI', status: 'idle' },
        { id: 'cli-qoder', name: 'Qoder CLI', status: 'idle' },
        { id: 'cli-codex', name: 'Codex CLI', status: 'idle' },
      ],
      getProjectFullDetail: mockGetProjectFullDetail,
      approveProject: vi.fn(),
      retryPlan: vi.fn(),
      dispatchTasks: vi.fn(),
      deliverProject: vi.fn(),
      closeProject: vi.fn(),
      deleteProject: vi.fn(),
    };
  },
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

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function loadFixture(name: string): ProjectFullDetail {
  const path = join(process.cwd(), '..', 'tests', 'fixtures', 'kswarm', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ProjectFullDetail;
}

function renderProject(detail: ProjectFullDetail) {
  mockGetProjectFullDetail.mockResolvedValue(detail);
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`/projects/${detail.project.id}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>
  );
}

describe('agent runtime status cards', () => {
  it('shows waiting, blocked, and failed status from assigned task context even when agents look idle', async () => {
    renderProject(loadFixture('full-detail-blocked-project.json'));

    await waitFor(() => expect(screen.getByText('技术大会演讲报告')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /智能体/ }));

    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getByText(/阻塞 · item-6 · missing_review_evidence/)).toBeInTheDocument();
    expect(screen.getByText(/等待 · item-7/)).toBeInTheDocument();
    expect(screen.getByText(/失败 · item-8/)).toBeInTheDocument();
  });
});
