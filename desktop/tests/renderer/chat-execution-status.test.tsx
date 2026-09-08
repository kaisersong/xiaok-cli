import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatExecutionStatus } from '../../renderer/src/components/ChatExecutionStatus';
afterEach(cleanup);

function show(root: any, extra: any = {}, phase = 'live') {
  const state = { phase, error: null, projection: { activeGroupId: 'g', threadDeleteState: 'none', error: null,
    snapshot: { group: { groupId: 'g', historicalOnly: false }, pendingApprovals: [] }, root, ...extra } };
  const connection = { subscribe: vi.fn(() => () => {}), getSnapshot: () => state } as any;
  render(<LocaleProvider><ChatExecutionStatus connection={connection} sourceTaskId="task" /></LocaleProvider>);
}
describe('current task execution status', () => {
  it('shows pending root as queued, not thinking', () => {
    show({ sourceTaskId: 'task', status: 'pending', executionActive: false });
    expect(screen.getByText(/排队中/)).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
  });
  it('shows active root as executing without claiming model thinking', () => {
    show({ sourceTaskId: 'task', status: 'running', executionActive: true });
    expect(screen.getByText('正在执行…')).toBeInTheDocument();
  });
  it.each(['old-task', undefined])('does not use root from a different task: %s', sourceTaskId => {
    show({ sourceTaskId, status: 'pending' });
    expect(screen.getByText(/同步执行状态/)).toBeInTheDocument();
  });
  it('does not use historical group', () => {
    show({ sourceTaskId: 'task', status: 'pending' }, { snapshot: { group: { groupId: 'old', historicalOnly: true } } });
    expect(screen.getByText(/同步执行状态/)).toBeInTheDocument();
  });
  it('reports disconnected state without stale thinking', () => {
    show({ sourceTaskId: 'task', status: 'running' }, {}, 'error');
    expect(screen.getByText(/连接中断/)).toBeInTheDocument();
  });
  it('shows only approval matching current root turn', () => {
    show({ id: 'root', turn: 2, turnId: 't2', sourceTaskId: 'task', status: 'running' }, {
      snapshot: { group: { groupId: 'g', historicalOnly: false }, pendingApprovals: [
        { agentId: 'root', turn: 2, turnId: 't2', status: 'pending' },
      ] },
    });
    expect(screen.getByText(/等待工具授权/)).toBeInTheDocument();
  });
});
