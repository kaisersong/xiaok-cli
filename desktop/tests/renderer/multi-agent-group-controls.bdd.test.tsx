import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MultiAgentGroupControls } from '../../renderer/src/components/MultiAgentGroupControls';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { MultiAgentDesktopAPI } from '../../shared/multi-agent-types';

afterEach(cleanup);
function setup(historical = false) {
  const api = {
    getMultiAgentResources: vi.fn(async () => ({ items: [{ resourceId: 'resource', groupId: 'g', agentId: 'child', kind: 'worktree', canonicalPath: 'worktree-path',
      state: 'cleanup_pending', cleanupEligibility: 'manual', lastError: 'worktree_requires_manual_keep' }], nextCursor: null })),
    resolveMultiAgentResource: vi.fn(async () => ({ operationId: 'op', state: 'completed' })),
    resetMultiAgentGroup: vi.fn(async () => ({ operationId: 'reset', state: 'cleanup_pending', groupId: 'g' })),
    getMultiAgentOperation: vi.fn(async () => null),
  } as unknown as MultiAgentDesktopAPI;
  const refresh = vi.fn();
  render(<LocaleProvider><MultiAgentGroupControls api={api} threadId="t" groupId="g" activeGroupId="g" historical={historical}
    ready blocked={false} resetPending={false} onChanged={refresh} /></LocaleProvider>);
  return { api, refresh };
}
describe('BDD: explicit group reset and registered resource disposition', () => {
  it('A26/U6 Given historical disk residue, Then keep requires confirmation, addresses its resource ID only and does not enable a historical reset', async () => {
    const { api } = setup(true);
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '工作树与清理状态' }));
    await screen.findByText('worktree-path');
    fireEvent.click(screen.getByRole('button', { name: '保留工作树并解除关联' }));
    expect(api.resolveMultiAgentResource).not.toHaveBeenCalled();
    let dialog = screen.getByRole('group', { name: '确认资源处置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(api.resolveMultiAgentResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保留工作树并解除关联' }));
    dialog = screen.getByRole('group', { name: '确认资源处置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认保留' }));
    await vi.waitFor(() => expect(api.resolveMultiAgentResource).toHaveBeenCalledTimes(1));
    const input = vi.mocked(api.resolveMultiAgentResource).mock.calls[0][0];
    expect(input).toEqual({ threadId: 't', groupId: 'g', resourceId: 'resource', action: 'keep', operationId: expect.any(String) });
  });
  it('A40/U7 Given a confirmed reset with pending cleanup, Then the UI preserves the pending state without submitting a second reset', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: '新建执行组' }));
    expect(api.resetMultiAgentGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认新建执行组' }));
    await screen.findByText('正在关闭旧执行组并清理资源；完成后自动创建新组。');
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    expect(api.resetMultiAgentGroup).toHaveBeenCalledTimes(1);
    expect(api.resetMultiAgentGroup).toHaveBeenCalledWith({ threadId: 't', expectedGroupId: 'g', operationId: expect.any(String), confirmTerminate: true });
  });
});
