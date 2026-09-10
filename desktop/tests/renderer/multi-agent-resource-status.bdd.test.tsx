import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { DesktopAgentSnapshot, ExecutionAuthorizationUserSnapshot } from '../../shared/multi-agent-types';
import { approval, approvalFixture, snapshot } from './approval-ui-fixture';

const stops: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); });

async function mount(patch: Partial<DesktopAgentSnapshot> = {}, member: 'root' | 'child' = 'root', language: 'zh' | 'en' = 'zh', configure?: (f: ReturnType<typeof approvalFixture>) => void) {
  localStorage.setItem('xiaok:locale', language);
  const views = [approval(), ...(member === 'child' ? [approval('approval-child', 'child')] : [])];
  const initial = snapshot(views);
  if (member === 'root') initial.root = { ...initial.root!, ...patch };
  else {
    initial.agents = initial.agents.map(agent => ({ ...agent, ...patch }));
    initial.residentAgents = initial.agents;
  }
  const f = approvalFixture(views, initial); configure?.(f);
  const connection = new MultiAgentConnection(f.api, 'thread');
  stops.push(connection.start());
  await act(async () => { render(<LocaleProvider><MultiAgentPanel connection={connection} api={f.api} onSelectGroup={vi.fn()} /></LocaleProvider>); });
  if (member === 'child') fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button'));
  const detail = document.querySelector('.multi-agent-detail');
  expect(detail).not.toBeNull();
  return { f, detail: within(detail as HTMLElement), metadata: detail!.querySelector('.multi-agent-meta')! };
}

describe('U1/AP7: real Panel resource facts do not invent a stop request', () => {
  it.each(['zh', 'en'] as const)('a running root awaiting approval without a stop request shows occupied resources in %s', async language => {
    const { f, detail } = await mount({}, 'root', language);
    expect(screen.getByRole('region', { name: language === 'zh' ? /工具审批/ : /Tool approval/ })).toBeVisible();
    expect(detail.queryByText(language === 'zh' ? '停止请求已发出' : 'Stop requested')).toBeNull();
    expect(detail.getByText(language === 'zh' ? '执行资源占用中' : 'Execution resources in use')).toBeVisible();
    expect(f.api.interruptAgent).not.toHaveBeenCalled(); expect(f.api.closeAgent).not.toHaveBeenCalled();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it.each([
    ['root', 'requested'], ['root', 'stalled'], ['child', 'requested'], ['child', 'stalled'],
  ] as const)('actual %s %s stop facts remain visible', async (member, stopState) => {
    const { detail } = await mount({ stopState }, member);
    expect(detail.getByText('停止请求已发出')).toBeVisible();
    expect(detail.queryByText('执行资源占用中')).toBeNull();
  });

  it.each(['requested', 'stalled'] as const)('physical cleanup pending takes precedence over %s', async stopState => {
    const { detail } = await mount({ stopState, cleanupPending: true });
    expect(detail.getByText('资源清理中')).toBeVisible();
    expect(detail.queryByText('停止请求已发出')).toBeNull();
    expect(detail.queryByText('资源已释放')).toBeNull();
  });

  it('confirmed release takes precedence over an old stop request', async () => {
    const { detail } = await mount({ stopState: 'requested', executionActive: false, sessionResident: false, runtimeResident: false, resourcesReleased: true });
    expect(detail.getByText('资源已释放')).toBeVisible(); expect(detail.queryByText('停止请求已发出')).toBeNull();
  });

  it('a completed resumable child keeps its existing continuation fact', async () => {
    const { detail } = await mount({ status: 'completed', executionActive: false, resumable: true }, 'child');
    expect(detail.getByText('会话可继续')).toBeVisible(); expect(detail.queryByText('停止请求已发出')).toBeNull();
  });

  it.each(['executionActive', 'runtimeResident', 'sessionResident'] as const)('a sole true %s fact describes occupied resources without inferring a stop', async flag => {
    const { detail } = await mount({ executionActive: false, runtimeResident: false, sessionResident: false, [flag]: true });
    expect(detail.queryByText('停止请求已发出')).toBeNull(); expect(detail.getByText('执行资源占用中')).toBeVisible();
  });

  it('no active/resident/released/resumable fact does not manufacture any physical status', async () => {
    const { detail, metadata } = await mount({ status: 'completed', executionActive: false, runtimeResident: false, sessionResident: false });
    for (const label of ['停止请求已发出', '执行资源占用中', '资源已释放', '会话可继续', '资源清理中']) expect(detail.queryByText(label)).toBeNull();
    expect(metadata).toHaveTextContent('root_g');
  });

  it('unknown pending grant is described as unconfirmed while execution remains blocked', async () => {
    const authorization: ExecutionAuthorizationUserSnapshot = { bootId: 'boot', permissionRevision: 1, executionAllowed: false, persistenceState: 'unknown',
      pendingOperation: { operationId: 'pending-grant', expectedPermissionRevision: 0, executionAllowed: true, confirm: true } };
    const { f } = await mount({ status: 'completed', executionActive: false, resumable: true }, 'child', 'zh', f => {
      f.api.subscribeLocalExecutionAuthorization.mockImplementation(async input => ({ subscriptionId: input.subscriptionId, authorization }));
    });
    expect(screen.queryByText('本地执行已暂停')).toBeNull();
    expect(screen.getByText('暂时无法确认设置，已阻止启动任务')).toBeVisible();
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'keep followup draft' } });
    for (const name of ['发送消息', '继续执行', '新建执行组']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('button', { name: '工作树与清理状态' })).toBeEnabled();
    expect(f.api.sendAgentMessage).not.toHaveBeenCalled(); expect(f.api.followupAgent).not.toHaveBeenCalled();
  });
});
