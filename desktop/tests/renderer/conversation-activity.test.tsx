import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ConversationActivityPanel } from '../../renderer/src/components/ConversationActivityPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), work: vi.fn(), reporting: vi.fn(), stop: vi.fn(), subscribe: vi.fn(() => vi.fn()) }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({
  getConversationActivities: mocks.list, getWorkActivity: mocks.work, updateWorkReporting: mocks.reporting,
  stopWorkWatch: mocks.stop, subscribeConversationActivities: mocks.subscribe,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projection = { watchId: 'watch', executionState: 'accepted', businessOutcome: 'unknown', freshness: 'fresh', sourceSequence: 1,
  revision: 1, lastProgressAt: null, lastHeartbeatAt: 1000, lastReportAt: null, evidenceRefs: [], summary: '<img src=x onerror=alert(1)>' };
const watch = { watchId: 'watch', workId: 'project', source: 'kswarm', status: 'active', preference: 'normal', policyRevision: 0, nextReportDueAt: 301000 };
function mount() {
  return render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" /></LocaleProvider></MemoryRouter>);
}
describe('conversation work feedback', () => {
  it('loads the next activity page so later work cards are not silently hidden', async () => {
    mocks.list.mockImplementation(async (input: { afterLocalSeq?: number }) => input.afterLocalSeq
      ? [{ activityId: 'later', localSeq: 201, watchId: 'later-watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]
      : Array.from({ length: 200 }, (_, index) => ({ activityId: `id-${index}`, localSeq: index + 1, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockImplementation(async (id: string) => ({ watch: { ...watch, watchId: id }, projection: { ...projection, watchId: id } }));
    mount();
    await waitFor(() => expect(screen.getByTestId('activity-work-later-watch')).toBeVisible());
  });
  it('shows a loading error even before the first card can be read', async () => {
    mocks.list.mockRejectedValueOnce(new Error('read failed')); mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  });
  it('shows one card for repeated observations and escapes source-provided text', async () => {
    mocks.list.mockResolvedValue([1, 2].map(localSeq => ({ activityId: `id-${localSeq}`, localSeq, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockResolvedValue({ watch, projection });
    const { container } = mount();
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
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toBeVisible());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'critical_only' } });
    await waitFor(() => expect(mocks.reporting).toHaveBeenCalledWith({ watchId: 'watch', preference: 'critical_only', expectedPolicyRevision: 0 }));
    fireEvent.click(screen.getByRole('button', { name: /停止跟进|Stop following/ }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({ watchId: 'watch', expectedPolicyRevision: 1 }));
  });
});
