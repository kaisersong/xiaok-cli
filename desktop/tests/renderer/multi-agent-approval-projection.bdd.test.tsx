import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMultiAgentConnection } from '../../renderer/src/hooks/useMultiAgentConnection';
import type { MultiAgentDesktopAPI, MultiAgentTransport } from '../../shared/multi-agent-types';
import { approval, approvalFixture, deferred, snapshot, type ApprovalSnapshot } from './approval-ui-fixture';

const desktop = vi.hoisted(() => ({ api: undefined as MultiAgentDesktopAPI | undefined }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => desktop.api }));
function Summary({ threadId = 'thread', groupId }: { threadId?: string; groupId?: string }) {
  const { summary } = useMultiAgentConnection(threadId, groupId);
  return <><output data-testid="approval-count">{String((summary as typeof summary & { pendingApprovalCount?: number }).pendingApprovalCount)}</output>
    <output data-testid="phase">{summary.phase}</output><output data-testid="history">{String(summary.historicalSelection)}</output></>;
}
afterEach(() => { cleanup(); desktop.api = undefined; });
async function mount(f: ReturnType<typeof approvalFixture>, groupId?: string) {
  desktop.api = f.api; let mounted!: ReturnType<typeof render>;
  await act(async () => { mounted = render(<Summary groupId={groupId} />); }); return mounted;
}
const count = (expected: number) => expect(screen.getByTestId('approval-count')).toHaveTextContent(String(expected));
function failure(groupId = 'g'): MultiAgentTransport['envelope'] {
  return { channel: 'runtime_error', code: 'multi_agent_approval_persistence_failed', groupId, threadId: 'thread', bootId: 'boot', approvalPersistenceState: 'unknown' };
}

describe('AP7/AP10: actual hook and connection keep main approval facts across selection and failures', () => {
  it('root-only main snapshot count is exposed independently of child/history eligibility', async () => {
    const f = approvalFixture(); await mount(f); count(1);
  });
  it('same-group group_changed updates the authoritative count without switching historical selection', async () => {
    const history: ApprovalSnapshot = { ...snapshot([]), group: { ...snapshot([]).group!, groupId: 'history', historicalOnly: true }, pendingApprovalCount: 1 };
    const f = approvalFixture([], history); await mount(f, 'history'); count(1);
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g', newGroupId: 'g', pendingApprovalCount: 2 }));
    await vi.waitFor(() => count(2)); expect(screen.getByTestId('history')).toHaveTextContent('true');
    expect(f.api.subscribeMultiAgents).toHaveBeenCalledTimes(1);
  });
  it('current-group persistence failure is retained even while the selected historical group differs', async () => {
    const history = { ...snapshot([]), group: { ...snapshot([]).group!, groupId: 'history', historicalOnly: true }, pendingApprovalCount: 3 };
    const f = approvalFixture([], history); await mount(f, 'history'); count(3);
    await act(async () => f.emit(failure()));
    count(0);
    await vi.waitFor(() => expect(f.api.getMultiAgentSnapshot).toHaveBeenCalled());
    expect(screen.getByTestId('history')).toHaveTextContent('true');
  });
  it('failure before an initial pending ACK fences its same-group equal-S count and survives reselecting the same thread', async () => {
    const f = approvalFixture(), initial = deferred<Awaited<ReturnType<MultiAgentDesktopAPI['subscribeMultiAgents']>>>();
    f.api.subscribeMultiAgents.mockImplementationOnce(async (input, listener) => {
      f.subscriptions.push({ id: input.subscriptionId, listener }); return initial.promise;
    });
    const mounted = await mount(f);
    await act(async () => { f.emit(failure()); initial.resolve({ subscriptionId: f.subscriptions[0]!.id, snapshot: f.current() }); });
    await vi.waitFor(() => count(0));
    await act(async () => mounted.rerender(<Summary groupId="g" />));
    await vi.waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('live')); count(0);
  });
  it('confirmed new active group retires old thread failure; an old group failure cannot clear the new pending count', async () => {
    const f = approvalFixture(); await mount(f); count(1);
    await act(async () => f.emit(failure())); count(0);
    const newApproval = { ...approval('new', 'new-child'), groupId: 'g2' };
    const next = { ...snapshot([newApproval]), activeGroupId: 'g2', threadRevision: 2, group: { ...snapshot().group!, groupId: 'g2' } };
    f.setSnapshot(next);
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g', newGroupId: 'g2', pendingApprovalCount: 1 }));
    await vi.waitFor(() => count(1));
    await act(async () => f.emit(failure()));
    count(1);
  });
  it('deleted clears count permanently and a late higher revision cannot revive it', async () => {
    const f = approvalFixture(); await mount(f); count(1);
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g', newGroupId: null,
      threadDeleteState: 'deleted', pendingApprovalCount: 0 }));
    await vi.waitFor(() => count(0));
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 3, oldGroupId: null, newGroupId: 'g', pendingApprovalCount: 9 }));
    count(0);
  });
  it('API replacement clears old failure/count immediately and ignores the stopped sender', async () => {
    const first = approvalFixture(), mounted = await mount(first); count(1);
    const second = approvalFixture([], snapshot([])); desktop.api = second.api;
    await act(async () => mounted.rerender(<Summary />)); count(0);
    await act(async () => first.emit(failure())); count(0);
    expect(first.api.unsubscribeMultiAgents).toHaveBeenCalledTimes(1);
  });
  it('a pre-group initial snapshot cannot retire a failure already received for the first real group', async () => {
    const f = approvalFixture(), initial = deferred<Awaited<ReturnType<MultiAgentDesktopAPI['subscribeMultiAgents']>>>();
    f.api.subscribeMultiAgents.mockImplementationOnce(async (input, listener) => {
      f.subscriptions.push({ id: input.subscriptionId, listener }); return initial.promise;
    });
    await mount(f);
    const empty = { ...snapshot([]), group: null, root: null, activeGroupId: null, threadRevision: 0 };
    await act(async () => { f.emit(failure()); initial.resolve({ subscriptionId: f.subscriptions[0]!.id, snapshot: empty }); });
    await vi.waitFor(() => expect(f.api.getMultiAgentSnapshot).toHaveBeenCalled());
    count(0);
  });
});
