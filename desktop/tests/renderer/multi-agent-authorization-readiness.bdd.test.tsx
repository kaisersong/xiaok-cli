import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { localExecutionAuthorization } from '../../renderer/src/lib/local-execution-authorization';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { MultiAgentDesktopAPI, MultiAgentManagedResource } from '../../shared/multi-agent-types';
import { agent, approvalFixture, deferred, snapshot } from './approval-ui-fixture';

const stops: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); });

type Unavailable = 'initial-loading' | 'initial-error' | 'retained-loading' | 'retained-error' | 'unsupported';
async function fixture(mode: Unavailable | 'allowed', running = false, configure?: (f: ReturnType<typeof approvalFixture>) => void) {
  const initial = snapshot([]);
  const child = { ...agent('child', 1), ...(running ? {} : { status: 'completed' as const, executionActive: false,
    runtimeResident: false, resumable: true, activationState: 'settled' as const }) };
  initial.agents = [child]; initial.residentAgents = [child]; initial.hasAgentHistory = true;
  initial.counts = { total: 2, running: running ? 2 : 1, completed: running ? 0 : 1, failed: 0, unread: 0 };
  const f = approvalFixture([], initial);
  const resources: MultiAgentManagedResource[] = [{ resourceId: 'worktree', groupId: 'g', agentId: 'child', ownerBootId: 'boot',
    kind: 'worktree', canonicalPath: 'workspace', allocationToken: 'allocation', cleanupPolicy: 'keep',
    cleanupEligibility: 'manual', state: 'cleanup_pending' }];
  f.api.getMultiAgentResources = vi.fn<MultiAgentDesktopAPI['getMultiAgentResources']>(async () => ({ items: resources, nextCursor: null }));
  f.api.resolveMultiAgentResource = vi.fn<MultiAgentDesktopAPI['resolveMultiAgentResource']>(async input => ({ operationId: input.operationId, state: 'completed' }));
  f.api.resetMultiAgentGroup = vi.fn<MultiAgentDesktopAPI['resetMultiAgentGroup']>();
  f.api.interruptAgent.mockImplementation(async input => ({ operationId: input.operationId, state: 'applied' }));
  f.api.closeAgent.mockImplementation(async input => ({ operationId: input.operationId, state: 'completed' }));
  configure?.(f);
  const owner = localExecutionAuthorization(f.api)!;
  if (mode.startsWith('retained')) {
    const stop = owner.subscribe(() => {});
    await f.api.subscribeLocalExecutionAuthorization.mock.results[0]!.value;
    expect(owner.getSnapshot().phase).toBe('live');
    expect(owner.getSnapshot().authorization?.executionAllowed).toBe(true);
    stop();
  }
  const pending = deferred<Awaited<ReturnType<MultiAgentDesktopAPI['subscribeLocalExecutionAuthorization']>>>();
  if (mode.endsWith('loading')) f.api.subscribeLocalExecutionAuthorization.mockReturnValue(pending.promise);
  if (mode.endsWith('error')) f.api.subscribeLocalExecutionAuthorization.mockRejectedValue(new Error('subscription unavailable'));
  if (mode === 'unsupported') Reflect.deleteProperty(f.api, 'subscribeLocalExecutionAuthorization');
  const connection = new MultiAgentConnection(f.api, 'thread'); stops.push(connection.start());
  await act(async () => { render(<LocaleProvider><MultiAgentPanel connection={connection} api={f.api} onSelectGroup={vi.fn()} /></LocaleProvider>); });
  expect(connection.getSnapshot().phase).toBe('live');
  expect(screen.getByRole('region', { name: '双鱼座' })).toBeVisible();
  return { f, owner, connection, accept: () => pending.resolve({ subscriptionId: f.api.subscribeLocalExecutionAuthorization.mock.calls.at(-1)![0].subscriptionId,
    authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } }) };
}

describe('W1: new commands require a live confirmed authorization, not a cached allowed value', () => {
  it('the first remount commit cannot expose cached allowed or open reset before the subscription passive effect', async () => {
    const f = approvalFixture([], snapshot([]));
    const owner = localExecutionAuthorization(f.api)!;
    const stop = owner.subscribe(() => {});
    await f.api.subscribeLocalExecutionAuthorization.mock.results[0]!.value;
    expect(owner.getSnapshot().phase).toBe('live'); stop();
    f.api.subscribeLocalExecutionAuthorization.mockReturnValue(new Promise(() => {}));
    const connection = new MultiAgentConnection(f.api, 'thread'); stops.push(connection.start());
    await act(async () => {}); expect(connection.getSnapshot().phase).toBe('live');
    const firstCommit: boolean[] = [];
    function LayoutProbe({ children }: { children: ReactNode }) {
      useLayoutEffect(() => {
        const reset = screen.getByRole('button', { name: '新建执行组' }) as HTMLButtonElement;
        firstCommit.push(reset.disabled);
        reset.click();
      }, []);
      return children;
    }
    await act(async () => { render(<LocaleProvider><LayoutProbe><MultiAgentPanel connection={connection} api={f.api} onSelectGroup={vi.fn()} /></LayoutProbe></LocaleProvider>); });
    expect.soft(firstCommit).toEqual([true]);
    expect(screen.queryByRole('group', { name: '确认新建执行组' })).toBeNull();
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    expect(f.api.followupAgent).not.toHaveBeenCalled();
  });

  it('releasing one of two readers keeps the shared live subscription until the final reader leaves', async () => {
    const f = approvalFixture([], snapshot([]));
    const owner = localExecutionAuthorization(f.api)!;
    const first = owner.subscribe(() => {}), second = owner.subscribe(() => {});
    await f.api.subscribeLocalExecutionAuthorization.mock.results[0]!.value;
    first(); expect(owner.getSnapshot().phase).toBe('live');
    expect(f.api.unsubscribeLocalExecutionAuthorization).not.toHaveBeenCalled();
    second(); expect(owner.getSnapshot().phase).toBe('loading');
    expect(f.api.unsubscribeLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
    const [input, receive] = f.api.subscribeLocalExecutionAuthorization.mock.calls[0]!;
    receive({ subscriptionId: input.subscriptionId, authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } });
    expect(owner.getSnapshot().phase).toBe('loading');
  });

  it('an original unknown-operation read remains usable after authorization transport failure without sending again or granting execution', async () => {
    let failHandshake!: () => void;
    const { f } = await fixture('allowed', false, f => {
      f.api.subscribeLocalExecutionAuthorization.mockImplementation((input, receive) => {
        receive({ subscriptionId: input.subscriptionId, authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } });
        return new Promise((_, reject) => { failHandshake = () => reject(new Error('initial reply lost after live push')); });
      });
      f.api.sendAgentMessage.mockImplementation(async input => ({ operationId: input.operationId, state: 'unknown', groupId: 'g' }));
      f.api.getMultiAgentOperation.mockImplementation(async input => ({ groupId: 'g', operationId: input.operationId,
        command: 'send', requestHash: 'original-hash', applyState: 'applied', result: { operationId: input.operationId, state: 'applied' } }));
    });
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'original unknown message' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送消息' })));
    const original = f.api.sendAgentMessage.mock.calls[0]![0];
    await act(async () => failHandshake());
    expect(screen.getByText('无法读取任务执行设置')).toBeVisible();
    expect(screen.getByRole('button', { name: '查询操作状态' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '查询操作状态' })));
    expect(f.api.getMultiAgentOperation).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', groupId: 'g', operationId: original.operationId });
    expect(screen.getByText('已接收')).toBeVisible();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    expect(f.api.sendAgentMessage).toHaveBeenCalledTimes(1); expect(f.api.followupAgent).not.toHaveBeenCalled();
    expect(f.api.resetMultiAgentGroup).not.toHaveBeenCalled();
  });

  it.each(['initial-loading', 'initial-error', 'retained-loading', 'retained-error', 'unsupported'] as const)(
    '%s blocks send/followup/reset with truthful connection feedback and preserves draft/resource access', async mode => {
      const { f, owner } = await fixture(mode);
      if (mode.startsWith('retained')) expect(owner.getSnapshot().authorization?.executionAllowed).toBe(true);
      fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'preserve unsent followup' } });
      for (const name of ['发送消息', '继续执行', '新建执行组']) {
        expect.soft(screen.getByRole('button', { name })).toBeDisabled();
      }
      expect(screen.getByText(mode.endsWith('loading') ? '加载中...' : '无法读取任务执行设置')).toBeVisible();
      expect(screen.queryByText('本地执行已暂停')).toBeNull();
      expect(screen.queryByText('暂时无法确认设置，已阻止启动任务')).toBeNull();
      expect(screen.getByLabelText('补充说明')).toBeEnabled();
      expect(screen.getByLabelText('补充说明')).toHaveValue('preserve unsent followup');
      expect(screen.getByRole('button', { name: '工作树与清理状态' })).toBeEnabled();
      expect(f.api.sendAgentMessage).not.toHaveBeenCalled(); expect(f.api.followupAgent).not.toHaveBeenCalled();
      expect(f.api.resetMultiAgentGroup).not.toHaveBeenCalled();
    });

  it.each(['initial-loading', 'initial-error', 'unsupported'] as const)('%s does not block stopping a running child or confirming resource keep', async mode => {
    const { f } = await fixture(mode, true);
    expect(screen.getByRole('button', { name: '中断当前轮' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '关闭 SubAgent' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '工作树与清理状态' }));
    await screen.findByText('workspace');
    fireEvent.click(screen.getByRole('button', { name: '保留工作树并解除关联' }));
    expect(screen.getByRole('button', { name: '确认保留' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认保留' })));
    expect(f.api.resolveMultiAgentResource).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', groupId: 'g',
      resourceId: 'worktree', action: 'keep', operationId: expect.any(String) });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '中断当前轮' })));
    expect(f.api.interruptAgent).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', groupId: 'g', agentId: 'child',
      expectedTurn: 3, operationId: expect.any(String) });
    fireEvent.click(screen.getByRole('button', { name: '关闭 SubAgent' }));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '关闭 SubAgent' })[1]!));
    expect(f.api.closeAgent).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', groupId: 'g', agentId: 'child',
      expectedTurn: 3, operationId: expect.any(String) });
    expect(f.api.resetMultiAgentGroup).not.toHaveBeenCalled();
  });

  it.each(['initial-loading', 'retained-loading'] as const)('%s only enables new actions after the actual pending subscription confirms allowed', async mode => {
    const { accept } = await fixture(mode);
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'kept during handshake' } });
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    await act(async () => accept());
    for (const name of ['发送消息', '继续执行', '新建执行组']) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.getByLabelText('补充说明')).toHaveValue('kept during handshake');
    expect(screen.queryByText('加载中...')).toBeNull();
  });

  it('a live confirmed allowed snapshot keeps the ordinary new-command controls enabled', async () => {
    await fixture('allowed');
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'confirmed command' } });
    for (const name of ['发送消息', '继续执行', '新建执行组']) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.queryByText('无法读取任务执行设置')).toBeNull();
  });

  it('the actual stalled + cleanupPending + runtime_blocked projection already advises a restart and keeps execution readonly', async () => {
    const initial = snapshot([]);
    initial.root = { ...initial.root!, stopState: 'stalled', cleanupPending: true };
    initial.runtimeError = 'runtime_blocked';
    const f = approvalFixture([], initial);
    const connection = new MultiAgentConnection(f.api, 'thread'); stops.push(connection.start());
    await act(async () => { render(<LocaleProvider><MultiAgentPanel connection={connection} api={f.api} onSelectGroup={vi.fn()} /></LocaleProvider>); });
    expect(screen.getByRole('alert')).toHaveTextContent('任务未响应停止；请保存工作后重启应用。');
    expect(screen.getByText('资源清理中')).toBeVisible();
    expect(screen.queryByText('停止请求已发出')).toBeNull();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
  });
});
