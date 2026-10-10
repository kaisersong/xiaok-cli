import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ConversationActivityPanel } from '../../renderer/src/components/ConversationActivityPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), work: vi.fn(), reporting: vi.fn(), stop: vi.fn(), inputs: vi.fn(), subscribe: vi.fn((_thread: string, _callback: () => void) => vi.fn()) }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({
  getConversationActivities: mocks.list, getWorkActivity: mocks.work, updateWorkReporting: mocks.reporting,
  stopWorkWatch: mocks.stop, subscribeConversationActivities: mocks.subscribe,
  getMcpTaskInputs: mocks.inputs,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projection = { watchId: 'watch', executionState: 'accepted', businessOutcome: 'unknown', freshness: 'fresh', sourceSequence: 1,
  revision: 1, lastProgressAt: null, lastHeartbeatAt: 1000, lastReportAt: null, evidenceRefs: [], summary: '<img src=x onerror=alert(1)>' };
const watch = { watchId: 'watch', workId: 'project', source: 'kswarm', status: 'active', preference: 'normal', policyRevision: 0, nextReportDueAt: 301000 };
function mount() {
  return render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" /></LocaleProvider></MemoryRouter>);
}
async function expand() {
  const toggle = await screen.findByTestId('activity-toggle');
  fireEvent.click(toggle);
}
describe('conversation work feedback', () => {
  it('reveals required plugin input and keeps its outcome visible after it is handled', async () => {
    let changed: (() => void) | undefined;
    mocks.subscribe.mockImplementation((_thread, callback) => { changed = callback; return vi.fn(); });
    mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'input_required', at: 1000, projection }]);
    const plugin = { ...watch, source: 'mcp' };
    mocks.work.mockResolvedValue({ watch: plugin, projection: { ...projection, executionState: 'input_required', summary: '选择报告格式' } });
    mocks.inputs.mockResolvedValue([{ inputId: 'input', expectedDigest: 'digest', prompt: '选择报告格式', fields: [] }]);
    mount();
    await waitFor(() => expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded', 'true'));
    expect(await screen.findByRole('button', { name: /提交|Submit/ })).toBeVisible();
    mocks.work.mockResolvedValue({ watch: plugin, projection: { ...projection, executionState: 'cancelled', summary: '已取消' } });
    changed?.();
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toHaveTextContent('已取消'));
    expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('activity-toggle')).not.toBeDisabled();
  });
  it('keeps long completed reports collapsed and updates one fixed summary in place', async () => {
    let changed: (() => void) | undefined;
    mocks.subscribe.mockImplementation((_thread: string, callback: () => void) => { changed = callback; return vi.fn(); });
    mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'report', at: 1000, projection }]);
    const summary = '# 巡检报告\n' + '历史汇报正文。'.repeat(1000);
    mocks.work.mockResolvedValue({ watch, projection: { ...projection, executionState: 'completed', summary } });
    mount();
    const toggle = await screen.findByTestId('activity-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('activity-work-watch')).not.toBeInTheDocument();
    expect(screen.queryByText(summary)).not.toBeInTheDocument();
    mocks.work.mockResolvedValue({ watch, projection: { ...projection, executionState: 'running', summary: '当前工作正在推进' } });
    changed?.();
    await waitFor(() => expect(toggle).toHaveTextContent('当前工作正在推进'));
    expect(screen.getAllByTestId('activity-toggle')).toHaveLength(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expand();
    expect(screen.getByTestId('activity-details')).toHaveClass('max-h-64', 'overflow-y-auto');
    expect(screen.getAllByTestId('activity-work-watch')).toHaveLength(1);
  });
  it('loads the next activity page so later work cards are not silently hidden', async () => {
    mocks.list.mockImplementation(async (input: { afterLocalSeq?: number }) => input.afterLocalSeq
      ? [{ activityId: 'later', localSeq: 201, watchId: 'later-watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]
      : Array.from({ length: 200 }, (_, index) => ({ activityId: `id-${index}`, localSeq: index + 1, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockImplementation(async (id: string) => ({ watch: { ...watch, watchId: id }, projection: { ...projection, watchId: id } }));
    mount();
    await expand();
    await waitFor(() => expect(screen.getByTestId('activity-work-later-watch')).toBeVisible());
  });
  it('shows a loading error even before the first card can be read', async () => {
    mocks.list.mockRejectedValueOnce(new Error('read failed')); mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  });
  it('maps a failed owner attach to fixed copy and never renders the internal code', async () => {
    mocks.list.mockRejectedValue(new Error("Error invoking remote method 'desktop:activity:list': Error: activity_owner_unavailable"));
    const { container } = mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    const text = container.textContent ?? '';
    expect(text).toMatch(/xiaoK 的后台组件和当前版本不一致，部分功能暂时无法启动。请退出所有 xiaok 窗口后重新打开。|background component does not match this version/);
    expect(text).not.toMatch(/activity_owner|unavailable|mismatch|Error invoking/);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
  it('keeps the generic message for ordinary read failures', async () => {
    mocks.list.mockRejectedValue(new Error('read failed')); const { container } = mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    expect(container.textContent).not.toMatch(/后台组件|background component/);
  });
  it('shows one card for repeated observations and escapes source-provided text', async () => {
    mocks.list.mockResolvedValue([1, 2].map(localSeq => ({ activityId: `id-${localSeq}`, localSeq, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockResolvedValue({ watch, projection });
    const { container } = mount();
    await expand();
    await waitFor(() => expect(screen.getAllByTestId('activity-work-watch')).toHaveLength(1));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getByText(/已创建|Accepted/)).toBeVisible();
  });
  it('changes reporting preference and stops only the observation with its policy revision', async () => {
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch, projection });
    mocks.reporting.mockImplementation(async () => {
      const updated = { ...watch, preference: 'critical_only', policyRevision: 1 };
      mocks.work.mockResolvedValue({ watch: updated, projection }); return updated;
    });
    mocks.stop.mockResolvedValue({ ...watch, status: 'stopped', policyRevision: 2 });
    mount();
    await expand();
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toBeVisible());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'critical_only' } });
    await waitFor(() => expect(mocks.reporting).toHaveBeenCalledWith({ watchId: 'watch', preference: 'critical_only', expectedPolicyRevision: 0 }));
    fireEvent.click(screen.getByRole('button', { name: /停止跟进|Stop following/ }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({ watchId: 'watch', expectedPolicyRevision: 1 }));
  });
});
