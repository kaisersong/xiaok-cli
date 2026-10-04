import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatTaskApprovals } from '../../renderer/src/components/ChatTaskApprovals';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { approvalFixture } from './approval-ui-fixture';
const stops: Array<() => void> = [];
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); });
async function mount(historical = false) {
  const f = approvalFixture(); f.current().root!.sourceTaskId = 'task-current';
  f.current().group!.historicalOnly = historical;
  const connection = new MultiAgentConnection(f.api, 'thread'); stops.push(connection.start());
  await act(async () => render(<LocaleProvider><main aria-label="聊天"><ChatTaskApprovals connection={connection} api={f.api} sourceTaskId="task-current" /></main></LocaleProvider>));
  return f;
}
describe('chat task approval placement', () => {
  it('shows a task-scoped option directly in chat and sends an explicit user decision', async () => {
    const f = await mount();
    const chat = within(screen.getByRole('main', { name: '聊天' }));
    const once = await chat.findByRole('button', { name: '仅批准本次' });
    expect(once).toBeEnabled();
    expect(chat.getByText(/参数完全相同/)).toBeVisible();
    fireEvent.click(chat.getByRole('button', { name: '本任务内自动批准相同操作' }));
    expect(f.api.decideMultiAgentApproval).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approve_for_task' }));
  });
  it('never exposes actionable current-task approvals from historical groups', async () => {
    const f = await mount(true);
    expect(screen.queryByRole('button', { name: '仅批准本次' })).toBeNull();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });
});
