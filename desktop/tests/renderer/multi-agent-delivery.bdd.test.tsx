import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { TaskPanel } from '../../renderer/src/components/TaskPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { writeLocaleToStorage } from '../../renderer/src/storage';
import { locales } from '../../renderer/src/locales';
import type { MultiAgentDesktopAPI, MultiAgentDurableEvent, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types';

const stops: Array<() => void> = [];
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); writeLocaleToStorage('zh'); });
function setup(status: 'checking' | 'passed' | 'failed' | 'unknown', events: MultiAgentDurableEvent[] = []) {
  const snapshot: MultiAgentGroupSnapshot = { threadId: 't', activeGroupId: 'g', threadRevision: 1, hasAgentHistory: false,
    group: { groupId: 'g', threadId: 't', bootId: 'boot', historicalOnly: false, createdAt: 1,
      lastSeq: events.length, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null },
    root: { id: 'root_g', parentId: null, taskName: 'main', canonicalName: '/root', depth: 0, createdAt: 1,
      sessionResident: false, runtimeResident: false, cleanupPending: false, resumable: false,
      stopState: 'none', closeReason: null, activationState: 'settled', unreadMessages: 0,
      status: 'completed', turn: 1, turnId: 'turn-a', sourceTaskId: 'task-a',
      executionActive: false, resourcesReleased: true, hostDeliveryStatus: status, hostDeliveryCleanupPending: status === 'unknown',
      ...(['failed', 'unknown'].includes(status) ? { guardFailure: { code: 'delivery_timeout', stage: 'snapshot', needsExplicitFollowup: true } } : {}) },
    agents: [], residentAgents: [], lastSeq: events.length, nextAgentCursor: null,
    counts: { total: 1, completed: 1, running: 0, failed: 0, unread: 0 } };
  const api = { subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot })),
    getMultiAgentSnapshot: vi.fn(async () => snapshot), unsubscribeMultiAgents: vi.fn(async () => {}),
    getMultiAgentEvents: vi.fn(async () => ({ items: events, headSeq: events.length, hasMore: false, nextAfterSeq: events.length })),
    sendAgentMessage: vi.fn(), followupAgent: vi.fn(), interruptAgent: vi.fn(), closeAgent: vi.fn(),
  } as unknown as MultiAgentDesktopAPI;
  const connection = new MultiAgentConnection(api, 't'); stops.push(connection.start());
  return { connection, api, snapshot };
}
const statusText = {
  zh: { checking: '交付检查中', passed: '交付检查通过', failed: '交付检查失败', unknown: '交付检查结果未知' },
  en: { checking: 'Checking delivery', passed: 'Delivery verified', failed: 'Delivery check failed', unknown: 'Delivery outcome unknown' },
};
describe('R4 D9 delivery stays inside existing Task/Subagent contents', () => {
  it.each(['checking', 'passed', 'failed', 'unknown'] as const)('root-only %s changes recovery entry only for an error, never child history/counts', async status => {
    const f = setup(status); await vi.waitFor(() => expect(f.connection.getSummary().phase).toBe('live'));
    expect(f.connection.getSummary()).toMatchObject({ total: 0, failed: 0, hasAgentHistory: false,
      needsRecovery: status === 'failed' || status === 'unknown' });
  });

  for (const locale of ['zh', 'en'] as const) {
    it.each(['checking', 'passed', 'failed', 'unknown'] as const)(`${locale} root execution and %s delivery remain independent in the existing Subagent panel`, async status => {
      writeLocaleToStorage(locale); const f = setup(status);
      render(<LocaleProvider><MultiAgentPanel connection={f.connection} api={f.api} onSelectGroup={vi.fn()} /></LocaleProvider>);
      expect(await screen.findByText(statusText[locale][status])).toBeVisible();
      expect(screen.getByRole('button', { name: `${locales[locale].multiAgent.mainAgent} ${locales[locale].multiAgent.statuses.completed}` })).toBeVisible();
      expect(screen.getByText(locales[locale].multiAgent.released)).toBeVisible();
      expect(f.api.followupAgent).not.toHaveBeenCalled(); expect(f.api.interruptAgent).not.toHaveBeenCalled();
      if (status === 'failed' || status === 'unknown') {
        expect(screen.getByText(locale === 'zh' ? '交付检查超时' : 'Delivery check timed out')).toBeVisible();
        expect(screen.getByText(locale === 'zh' ? '如需补充交付，请明确发起新的主任务。' : 'Start a new main task explicitly to complete the delivery.')).toBeVisible();
      }
    });
  }

  it.each(['task-a', 'task-b', undefined])('Task panel only projects delivery matching its source %s without another subscription', async sourceTaskId => {
    const f = setup('failed');
    const props = { planSteps: [{ id: 'one', label: 'Existing plan', status: 'completed' }], status: 'completed' as const,
      result: null, generatedFiles: [], onFileClick: vi.fn(), onArtifactClick: vi.fn(), deliveryConnection: f.connection, sourceTaskId };
    const mounted = render(<LocaleProvider><TaskPanel {...props} /></LocaleProvider>);
    await vi.waitFor(() => expect(f.connection.getSummary().phase).toBe('live'));
    if (sourceTaskId === 'task-a') expect(await screen.findByText(statusText.zh.failed)).toBeVisible();
    else expect(screen.queryByText(statusText.zh.failed)).toBeNull();
    mounted.rerender(<LocaleProvider><TaskPanel {...props} sourceTaskId="task-b" /></LocaleProvider>);
    expect(screen.queryByText(statusText.zh.failed)).toBeNull();
    expect(screen.getByText('Existing plan')).toBeVisible(); expect(f.api.subscribeMultiAgents).toHaveBeenCalledTimes(1);
    expect(f.api.getMultiAgentSnapshot).not.toHaveBeenCalled();
  });

  it('a historic A delivery can be opened while B stays completed/passed and no continuation is dispatched', async () => {
    const event = { schemaVersion: 1, channel: 'durable', seq: 1, timestamp: 1, eventId: 'delivery-a', groupId: 'g', agentId: 'root_g', turnId: 'turn-a', kind: 'delivery',
      payload: { source: { sourceTaskId: 'task-a', groupId: 'g', rootTurnId: 'turn-a', rootEpoch: 1, bootId: 'boot', preparationId: 'prep-a' },
        delivery: { status: 'failed', guardFailure: { code: 'delivery_timeout', stage: 'snapshot', needsExplicitFollowup: true }, readerCleanup: 'settled', storeCleanup: 'settled' } } } as MultiAgentDurableEvent;
    const f = setup('passed', [event]); Object.assign(f.snapshot.root!, { sourceTaskId: 'task-b', turnId: 'turn-b', turn: 2 });
    render(<LocaleProvider><MultiAgentPanel connection={f.connection} api={f.api} onSelectGroup={vi.fn()} /></LocaleProvider>);
    const summary = await screen.findByText('交付记录：task-a'); fireEvent.click(summary);
    expect(screen.getByText(statusText.zh.failed)).toBeVisible(); expect(screen.getByText(statusText.zh.passed)).toBeVisible();
    expect(f.connection.getSnapshot().projection.root).toMatchObject({ sourceTaskId: 'task-b', status: 'completed', hostDeliveryStatus: 'passed' });
    expect(f.api.followupAgent).not.toHaveBeenCalled(); expect(f.api.sendAgentMessage).not.toHaveBeenCalled();
    act(() => f.connection.refresh());
    await vi.waitFor(() => expect(f.api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
    expect(screen.getByText(statusText.zh.passed)).toBeVisible();
  });
});
