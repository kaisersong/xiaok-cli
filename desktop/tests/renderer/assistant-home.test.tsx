import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetAssistantOverview, mockActivateAssistant } = vi.hoisted(() => ({
  mockGetAssistantOverview: vi.fn(),
  mockActivateAssistant: vi.fn(),
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    getAutomationOverviewSnapshot: vi.fn().mockResolvedValue({
      generatedAt: 1,
      sourceVersions: { loopStore: 1, timedActionStore: 1 },
      globalBackgroundAutoRunEnabled: true,
      totals: { loops: 0, userLoops: 0, schedules: 0, activeSchedules: 0, diagnostics: 0, recentFailures: 0 },
      recentFailures: [],
    }),
  },
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: [], projectsLoaded: true }),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    systemUsername: 'Tester',
    getAssistantOverview: mockGetAssistantOverview,
    activateAssistant: mockActivateAssistant,
  }),
}));

import {
  AssistantHomeCard,
  type AssistantHomeSnapshot,
} from '../../renderer/src/components/assistant/AssistantHomeCard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { WelcomePage } from '../../renderer/src/components/WelcomePage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(snapshot: AssistantHomeSnapshot, overrides: Partial<React.ComponentProps<typeof AssistantHomeCard>> = {}) {
  const callbacks = {
    onActivate: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onOpenDetails: vi.fn(),
  };
  render(
    <LocaleProvider>
      <AssistantHomeCard snapshot={snapshot} {...callbacks} {...overrides} />
    </LocaleProvider>,
  );
  return callbacks;
}

describe('AssistantHomeCard', () => {
  it('requires explicit consent before activating the personal assistant', () => {
    const callbacks = renderCard({
      profile: { status: 'needs_consent', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [],
      pendingCandidateCount: 0,
    });

    expect(screen.getByText('每日助理')).toBeInTheDocument();
    expect(screen.getByText(/启用后，小K会在晚间整理工作/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用每日助理' }));
    expect(callbacks.onActivate).toHaveBeenCalledTimes(1);
  });

  it('keeps the home card lightweight and renders at most three ranked suggestions', () => {
    const callbacks = renderCard({
      profile: { status: 'active', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [
        { id: 'one', title: '确认发布节奏', summary: '先冻结本周发布窗口' },
        { id: 'two', title: '整理评审结论', summary: '将一致意见归档' },
        { id: 'three', title: '跟进失败任务', summary: '检查昨晚失败原因' },
        { id: 'four', title: '不应出现在首页', summary: '首页最多三条' },
      ],
      pendingCandidateCount: 4,
    });

    expect(screen.getByText('确认发布节奏')).toBeInTheDocument();
    expect(screen.getByText('整理评审结论')).toBeInTheDocument();
    expect(screen.getByText('跟进失败任务')).toBeInTheDocument();
    expect(screen.queryByText('不应出现在首页')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看每日助理详情' }));
    expect(callbacks.onOpenDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '暂停每日助理' }));
    expect(callbacks.onPause).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit resume action while paused', () => {
    const callbacks = renderCard({
      profile: { status: 'paused', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [],
      pendingCandidateCount: 0,
    });

    expect(screen.getByText('每日助理已暂停')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复每日助理' }));
    expect(callbacks.onResume).toHaveBeenCalledTimes(1);
  });
});

describe('WelcomePage assistant integration', () => {
  it('reads the main-owned snapshot and refreshes it after explicit consent', async () => {
    mockGetAssistantOverview
      .mockResolvedValueOnce({
        profile: { status: 'needs_consent', eveningTime: '21:30', morningTime: '08:30' },
        suggestions: [],
        candidates: [],
        pendingCandidateCount: 0,
      })
      .mockResolvedValueOnce({
        profile: { status: 'active', eveningTime: '21:30', morningTime: '08:30' },
        suggestions: [{ id: 'suggestion-1', title: '授权后建议', summary: '来自 main-owned 快照' }],
        candidates: [],
        pendingCandidateCount: 0,
      });
    mockActivateAssistant.mockResolvedValue(undefined);

    render(
      <LocaleProvider>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </LocaleProvider>,
    );

    expect(await screen.findByRole('button', { name: '启用每日助理' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用每日助理' }));
    expect(await screen.findByText('授权后建议')).toBeInTheDocument();
    expect(mockActivateAssistant).toHaveBeenCalledTimes(1);
    expect(mockGetAssistantOverview).toHaveBeenCalledTimes(2);
  });
});
