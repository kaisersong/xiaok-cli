import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ConversationActivityPanel } from '../../renderer/src/components/ConversationActivityPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), work: vi.fn(), reporting: vi.fn(), stop: vi.fn(), subscribe: vi.fn((_threadId: string, _reload: () => void) => vi.fn()) }));
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
  it.each(['normal', 'quiet'])('offers only normal and quiet for a %s watch', async preference => {
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch: { ...watch, preference }, projection });
    mount();
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe(preference);
    expect(Array.from(select.options, option => option.value)).toEqual(['normal', 'quiet']);
  });
  it('preserves stored critical_only on mount, reload and stop without writing reporting preference', async () => {
    const stored = { ...watch, preference: 'critical_only', policyRevision: 7 };
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch: stored, projection });
    mocks.stop.mockResolvedValue({ ...stored, status: 'stopped', policyRevision: 8 });
    mount();
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('critical_only');
    expect(Array.from(select.options, option => option.value)).toEqual(['normal', 'critical_only', 'quiet']);
    expect(select.options[1]).toBeDisabled();
    expect(mocks.reporting).not.toHaveBeenCalled();
    mocks.subscribe.mock.calls[0][1]();
    await waitFor(() => expect(mocks.work).toHaveBeenCalledTimes(2));
    expect(select.value).toBe('critical_only');
    expect(mocks.reporting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /停止跟进|Stop following/ }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({ watchId: 'watch', expectedPolicyRevision: 7 }));
    await waitFor(() => expect(mocks.work).toHaveBeenCalledTimes(3));
    expect(mocks.reporting).not.toHaveBeenCalled();
  });
  it('allows an explicit change from stored critical_only to normal and removes the legacy option', async () => {
    const stored = { ...watch, preference: 'critical_only', policyRevision: 7 };
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch: stored, projection });
    mocks.reporting.mockImplementation(async () => {
      const updated = { ...stored, preference: 'normal', policyRevision: 8 };
      mocks.work.mockResolvedValue({ watch: updated, projection }); return updated;
    });
    mount();
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'normal' } });
    await waitFor(() => expect(mocks.reporting).toHaveBeenCalledWith({ watchId: 'watch', preference: 'normal', expectedPolicyRevision: 7 }));
    await waitFor(() => expect(Array.from(select.options, option => option.value)).toEqual(['normal', 'quiet']));
    expect(select.value).toBe('normal');
  });
  it('changes reporting preference and stops only the observation with its policy revision', async () => {
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch, projection });
    mocks.reporting.mockImplementation(async () => {
      const updated = { ...watch, preference: 'quiet', policyRevision: 1 };
      mocks.work.mockResolvedValue({ watch: updated, projection }); return updated;
    });
    mocks.stop.mockResolvedValue({ ...watch, status: 'stopped', policyRevision: 2 });
    mount();
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toBeVisible());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quiet' } });
    await waitFor(() => expect(mocks.reporting).toHaveBeenCalledWith({ watchId: 'watch', preference: 'quiet', expectedPolicyRevision: 0 }));
    fireEvent.click(screen.getByRole('button', { name: /停止跟进|Stop following/ }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({ watchId: 'watch', expectedPolicyRevision: 1 }));
  });
});
