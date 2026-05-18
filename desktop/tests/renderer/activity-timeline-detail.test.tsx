import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ActivityTimeline } from '../../renderer/src/components/projects/ActivityTimeline';

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    lastEvent: null,
    agents: [{ id: 'xiaok', name: 'xiaok' }],
  }),
}));

afterEach(() => {
  cleanup();
});

function renderTimeline(activities: any[]) {
  return render(
    <LocaleProvider>
      <ActivityTimeline
        project={{ id: 'proj-story', name: '写一个AI工作小故事', status: 'active' } as any}
        activities={activities}
        humanActions={[]}
      />
    </LocaleProvider>
  );
}

describe('ActivityTimeline detail visibility', () => {
  it('shows the concrete task failure error message', () => {
    renderTimeline([
      {
        type: 'task.failed',
        taskTitle: '设计故事核心冲突与角色',
        agent: 'xiaok',
        failureReason: 'agent_error',
        errorMessage: 'CLI and LLM both failed to generate output for "设计故事核心冲突与角色"',
        ts: '2026-05-18T05:40:22.839Z',
      },
    ]);

    expect(screen.getByText('任务失败')).toBeInTheDocument();
    expect(screen.getByText(/CLI and LLM both failed/)).toBeInTheDocument();
  });

  it('shows failed quality review feedback', () => {
    renderTimeline([
      {
        type: 'task.quality_reviewed',
        taskTitle: '撰写故事初稿',
        passed: false,
        feedback: '提交的产出物是一份交付报告，而不是故事初稿本身。',
        failureClass: 'quality_content_failed',
        action: 'rework',
        ts: '2026-05-18T05:41:49.005Z',
      },
    ]);

    expect(screen.getByText(/提交的产出物是一份交付报告/)).toBeInTheDocument();
  });
});
