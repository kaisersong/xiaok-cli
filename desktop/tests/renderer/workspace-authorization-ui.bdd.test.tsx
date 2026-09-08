import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { ExecutionAuthorizationRetry, ExecutionAuthorizationTransport, ExecutionAuthorizationUserSnapshot, MultiAgentDesktopAPI } from '../../shared/multi-agent-types';
import { useLocalExecutionAuthorization } from '../../renderer/src/hooks/useLocalExecutionAuthorization';

const desktop = vi.hoisted(() => ({ api: undefined as MultiAgentDesktopAPI | undefined }));
vi.mock('../../renderer/src/shared/desktop', async importOriginal => ({
  ...await importOriginal<typeof import('../../renderer/src/shared/desktop')>(), getDesktopApi: () => desktop.api,
}));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: vi.fn(async () => ({ enabled: false })),
  getKswarmConfig: vi.fn(async () => ({ maxConcurrentTasks: 3 })),
  getServiceStatus: vi.fn(async () => ({ checkedAt: 1, services: [] })),
} }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const allowed = (revision = 0, executionAllowed = true): ExecutionAuthorizationUserSnapshot => ({ bootId: 'boot-a', permissionRevision: revision, executionAllowed, persistenceState: 'confirmed' });
const retry = (desired = true): ExecutionAuthorizationRetry => ({ operationId: 'exec-auth:boot-a:4:original', expectedPermissionRevision: 4, executionAllowed: desired, confirm: true });
const unknown = (desired = true): ExecutionAuthorizationUserSnapshot => ({ ...allowed(5, false), persistenceState: 'unknown', pendingOperation: retry(desired) });

function apiFixture(initial = allowed()) {
  let current = initial;
  const subscriptions: Array<{ id: string; listener: (event: ExecutionAuthorizationTransport) => void }> = [];
  const api = {
    getLocalExecutionWorkspace: vi.fn(async () => ({ cwd: 'D:\\Chat Goal Workspace' })),
    getLocalExecutionAuthorization: vi.fn(async () => current),
    subscribeLocalExecutionAuthorization: vi.fn(async (input: { subscriptionId: string }, listener: (event: ExecutionAuthorizationTransport) => void) => {
      subscriptions.push({ id: input.subscriptionId, listener }); return { subscriptionId: input.subscriptionId, authorization: current };
    }),
    unsubscribeLocalExecutionAuthorization: vi.fn(async () => {}),
    setLocalExecutionAuthorization: vi.fn<MultiAgentDesktopAPI['setLocalExecutionAuthorization']>(async input => ({
      operationId: input.operationId, state: 'applied', permissionRevision: input.expectedPermissionRevision + 1,
      executionAllowed: input.executionAllowed, persistenceState: 'confirmed',
    })),
    getLocalExecutionAuthorizationOperation: vi.fn<MultiAgentDesktopAPI['getLocalExecutionAuthorizationOperation']>(async () => ({ kind: 'not_found', authorization: current })),
  };
  desktop.api = api as unknown as MultiAgentDesktopAPI;
  return { api, subscriptions, publish: (value: ExecutionAuthorizationUserSnapshot) => {
    current = value;
    for (const item of subscriptions) item.listener({ subscriptionId: item.id, authorization: value });
  }, setCurrent: (value: ExecutionAuthorizationUserSnapshot) => { current = value; } };
}
async function mount() {
  let mounted!: ReturnType<typeof render>;
  await act(async () => { mounted = render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={vi.fn()} /></LocaleProvider></MemoryRouter>); });
  return mounted;
}
function card() { return screen.getByRole('region', { name: '本地聊天与 Goal 执行' }); }
function ReadConsumer() {
  const state = useLocalExecutionAuthorization(desktop.api);
  return <output data-testid="shared-authorization">{state.authorization?.persistenceState}</output>;
}
beforeEach(() => {
  localStorage.clear();
  Object.assign(globalThis, { __APP_VERSION__: 'test', __APP_BUILD__: 'test' });
});
afterEach(() => { cleanup(); desktop.api = undefined; vi.restoreAllMocks(); });

describe('W12/W16: actual GeneralPane execution authorization card', () => {
  it('is accessible without a thread or children and requires an explicit inline revoke confirmation', async () => {
    const f = apiFixture(); await mount(); const controls = within(card());
    expect(controls.getByText(/项目.*自动化.*不受/)).toBeVisible();
    expect(document.querySelector('.chat-right-panel')).toBeNull();
    fireEvent.click(controls.getByRole('button', { name: '暂停本地执行' }));
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
    expect(controls.getByText(/重新授权不会续跑旧组/)).toBeVisible();
    fireEvent.click(controls.getByRole('button', { name: '确认暂停' }));
    await act(async () => {});
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledWith({
      operationId: expect.stringMatching(/^exec-auth:boot-a:0:[a-zA-Z0-9_-]+$/), expectedPermissionRevision: 0, executionAllowed: false, confirm: true,
    });
  });

  it.each([true, false])('unknown desired=%s is restored only by explicitly resending all four original main fields', async desired => {
    const f = apiFixture(unknown(desired)); await mount(); const controls = within(card());
    expect(controls.queryByRole('button', { name: '重新授权本地执行' })).toBeNull();
    expect(controls.queryByRole('button', { name: '暂停本地执行' })).toBeNull();
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
    fireEvent.click(controls.getByRole('button', { name: '只读查询' })); await act(async () => {});
    expect(f.api.getLocalExecutionAuthorizationOperation).toHaveBeenCalledWith({ operationId: retry(desired).operationId });
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
    fireEvent.click(controls.getByRole('button', { name: '核对并恢复记录' })); await act(async () => {});
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledExactlyOnceWith(retry(desired));
  });

  it('unknown without a readable pending record cannot guess parameters or offer a fresh grant', async () => {
    const { pendingOperation: _pending, ...snapshot } = unknown(); const f = apiFixture(snapshot); await mount();
    const controls = within(card());
    expect(controls.queryByRole('button', { name: '核对并恢复记录' })).toBeNull();
    expect(controls.queryByRole('button', { name: '重新授权本地执行' })).toBeNull();
    fireEvent.click(controls.getByRole('button', { name: '只读查询' })); await act(async () => {});
    expect(f.api.getLocalExecutionAuthorization).toHaveBeenCalled();
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
  });

  it.each([true, false])('same-revision unknown→confirmed allowed=%s retires pending; older and conflicting snapshots cannot restore it', async resultAllowed => {
    const f = apiFixture(unknown()); await mount(); expect(card()).toBeVisible();
    await act(async () => { f.publish(allowed(5, resultAllowed)); });
    const controls = within(card());
    expect(controls.queryByRole('button', { name: '核对并恢复记录' })).toBeNull();
    const expected = resultAllowed ? '暂停本地执行' : '重新授权本地执行';
    expect(controls.getByRole('button', { name: expected })).toBeEnabled();
    await act(async () => { f.publish(unknown()); f.publish(allowed(4, !resultAllowed)); f.publish(allowed(5, !resultAllowed)); });
    expect(controls.getByRole('button', { name: expected })).toBeEnabled();
    expect(controls.queryByRole('button', { name: '核对并恢复记录' })).toBeNull();
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
  });

  it('same-revision unknown cannot replace the original operation identity or desired value', async () => {
    const f = apiFixture(unknown()); await mount(); expect(card()).toBeVisible();
    await act(async () => { f.publish({ ...unknown(false), pendingOperation: { ...retry(false), operationId: 'exec-auth:boot-a:4:other' } }); });
    fireEvent.click(within(card()).getByRole('button', { name: '核对并恢复记录' })); await act(async () => {});
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledExactlyOnceWith(retry());
  });

  it('a mutation transport failure preserves its operation for read-only query and does not retry on render', async () => {
    const f = apiFixture(); f.api.setLocalExecutionAuthorization.mockRejectedValue(new Error('ACK lost'));
    await mount(); fireEvent.click(within(card()).getByRole('button', { name: '暂停本地执行' }));
    fireEvent.click(within(card()).getByRole('button', { name: '确认暂停' })); await act(async () => {});
    const original = f.api.setLocalExecutionAuthorization.mock.calls[0]![0];
    fireEvent.click(within(card()).getByRole('button', { name: '只读查询' })); await act(async () => {});
    expect(f.api.getLocalExecutionAuthorizationOperation).toHaveBeenCalledWith({ operationId: original.operationId });
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
  });

  it('late initial ACK cannot override a newer subscription candidate', async () => {
    const f = apiFixture(), initial = deferred<ExecutionAuthorizationTransport>();
    f.api.subscribeLocalExecutionAuthorization.mockImplementation(async (input, listener) => {
      f.subscriptions.push({ id: input.subscriptionId, listener }); return initial.promise;
    });
    await mount(); expect(card()).toBeVisible();
    await act(async () => { f.publish(unknown()); initial.resolve({ subscriptionId: f.subscriptions[0]!.id, authorization: allowed() }); });
    fireEvent.click(within(card()).getByRole('button', { name: '核对并恢复记录' })); await act(async () => {});
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledExactlyOnceWith(retry());
  });

  it('unmount/remount obtains main pending fields anew; old subscription/ACK cannot mutate the replacement API owner', async () => {
    const first = apiFixture(unknown()), mounted = await mount(); expect(card()).toBeVisible();
    const response = deferred<Awaited<ReturnType<MultiAgentDesktopAPI['setLocalExecutionAuthorization']>>>();
    first.api.setLocalExecutionAuthorization.mockReturnValue(response.promise);
    fireEvent.click(within(card()).getByRole('button', { name: '核对并恢复记录' }));
    mounted.unmount();
    const second = apiFixture({ ...allowed(0, false), bootId: 'boot-b' }); await mount();
    await act(async () => {
      first.publish(unknown()); response.resolve({ operationId: retry().operationId, state: 'applied', permissionRevision: 5, executionAllowed: true, persistenceState: 'confirmed' });
    });
    expect(within(card()).getByRole('button', { name: '重新授权本地执行' })).toBeEnabled();
    expect(within(card()).queryByRole('button', { name: '核对并恢复记录' })).toBeNull();
    expect(first.api.unsubscribeLocalExecutionAuthorization).toHaveBeenCalled();
    expect(second.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
    expect(localStorage.getItem('pendingOperation')).toBeNull();
  });

  it('English labels are semantic and do not reuse tool approval or Task answer controls', async () => {
    localStorage.setItem('xiaok:locale', 'en'); apiFixture(); await mount();
    const controls = within(screen.getByRole('region', { name: 'Local chat and Goal execution' }));
    expect(controls.getByRole('button', { name: 'Pause local execution' })).toBeVisible();
    expect(controls.queryByRole('button', { name: 'Approve this invocation only' })).toBeNull();
  });

  it('shows only the fixed main workspace path as text, without requiring a thread or changing grant parameters', async () => {
    const f = apiFixture(); f.api.getLocalExecutionWorkspace.mockResolvedValue({ cwd: '<img src=x> D:\\本地执行' });
    await mount();
    expect(within(card()).getByText('<img src=x> D:\\本地执行')).toBeVisible();
    expect(card().querySelector('img')).toBeNull();
    expect(f.api.getLocalExecutionWorkspace).toHaveBeenCalledExactlyOnceWith({});
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
  });

  it('a failed workspace-path read is explicit and does not turn a valid authorization snapshot into a guessed path or grant', async () => {
    const f = apiFixture(); f.api.getLocalExecutionWorkspace.mockRejectedValue(new Error('path unavailable'));
    await mount();
    expect(within(card()).getByText('执行工作区路径不可用')).toBeVisible();
    expect(within(card()).getByRole('button', { name: '暂停本地执行' })).toBeEnabled();
    expect(f.api.setLocalExecutionAuthorization).not.toHaveBeenCalled();
  });

  it('a late workspace path from an old API cannot replace the new owner path', async () => {
    const first = apiFixture(), path = deferred<{ cwd: string }>(); first.api.getLocalExecutionWorkspace.mockReturnValue(path.promise);
    const mounted = await mount(); expect(card()).toBeVisible(); mounted.unmount();
    const second = apiFixture(); second.api.getLocalExecutionWorkspace.mockResolvedValue({ cwd: 'NEW_FIXED_WORKSPACE' }); await mount();
    await act(async () => path.resolve({ cwd: 'OLD_FIXED_WORKSPACE' }));
    expect(within(card()).getByText('NEW_FIXED_WORKSPACE')).toBeVisible();
    expect(screen.queryByText('OLD_FIXED_WORKSPACE')).toBeNull();
  });
  it('an old API query refresh completing after replacement cannot clear the new API failure notice', async () => {
    const first = apiFixture(unknown()), refresh = deferred<ExecutionAuthorizationUserSnapshot>();
    first.api.getLocalExecutionAuthorization.mockReturnValue(refresh.promise);
    const mounted = await mount();
    fireEvent.click(within(card()).getByRole('button', { name: '只读查询' }));
    await vi.waitFor(() => expect(first.api.getLocalExecutionAuthorization).toHaveBeenCalledTimes(1));
    const second = apiFixture({ ...allowed(), bootId: 'boot-b' });
    second.api.setLocalExecutionAuthorization.mockRejectedValue(new Error('B ACK lost'));
    await act(async () => mounted.rerender(<MemoryRouter><LocaleProvider><DesktopSettings onClose={vi.fn()} /></LocaleProvider></MemoryRouter>));
    fireEvent.click(within(card()).getByRole('button', { name: '暂停本地执行' })); fireEvent.click(within(card()).getByRole('button', { name: '确认暂停' })); await act(async () => {});
    expect(within(card()).getByRole('alert')).toHaveTextContent('尚不能确认操作结果');
    await act(async () => refresh.resolve(allowed(5)));
    expect(within(card()).getByRole('alert')).toHaveTextContent('尚不能确认操作结果');
    expect(second.api.setLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
  });
  it('settings and a second rendered consumer share one push subscription and one fixed workspace read', async () => {
    const f = apiFixture(), first = await mount();
    let second!: ReturnType<typeof render>; await act(async () => { second = render(<ReadConsumer />); });
    expect(f.api.subscribeLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
    expect(f.api.getLocalExecutionWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => f.publish(unknown(false)));
    expect(screen.getByTestId('shared-authorization')).toHaveTextContent('unknown');
    second.unmount(); expect(f.api.unsubscribeLocalExecutionAuthorization).not.toHaveBeenCalled();
    first.unmount(); expect(f.api.unsubscribeLocalExecutionAuthorization).toHaveBeenCalledTimes(1);
  });
  it('a pending original revoke cannot be completed by a conflicting same-revision allowed projection', async () => {
    const f = apiFixture(unknown(false)); await mount();
    await act(async () => f.publish(allowed(5, true)));
    expect(within(card()).queryByRole('button', { name: '暂停本地执行' })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: '核对并恢复记录' })); await act(async () => {});
    expect(f.api.setLocalExecutionAuthorization).toHaveBeenCalledExactlyOnceWith(retry(false));
  });
  it('an API replacement does not inherit the outgoing card operation error', async () => {
    const first = apiFixture(); first.api.setLocalExecutionAuthorization.mockRejectedValue(new Error('old error'));
    const mounted = await mount(); fireEvent.click(within(card()).getByRole('button', { name: '暂停本地执行' }));
    fireEvent.click(within(card()).getByRole('button', { name: '确认暂停' })); await act(async () => {});
    expect(within(card()).getByRole('alert')).toBeVisible();
    apiFixture({ ...allowed(), bootId: 'new-boot' });
    await act(async () => mounted.rerender(<MemoryRouter><LocaleProvider><DesktopSettings onClose={vi.fn()} /></LocaleProvider></MemoryRouter>));
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(within(card()).getByRole('button', { name: '暂停本地执行' })).toBeEnabled();
  });
});
