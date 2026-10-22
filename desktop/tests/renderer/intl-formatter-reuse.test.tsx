import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
import { ConversationActivityPanel } from '../../renderer/src/components/ConversationActivityPanel';
import { CollaborationRoomsPage } from '../../renderer/src/components/collaboration/CollaborationRoomsPage';

const mocks = vi.hoisted(() => ({ list: vi.fn(), work: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({
  getConversationActivities: mocks.list, getWorkActivity: mocks.work,
  subscribeConversationActivities: () => mocks.unsubscribe,
}) }));
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({ useKSwarm: () => ({ agents: [] }) }));
vi.mock('../../renderer/src/lib/desktop', () => ({ desktop: {
  listCollaborationRooms: async () => ({ ok: true, rooms: [
    { roomId: 'active', title: 'Active room', revision: 1, status: 'active', lastActivityAt: '2026-01-01T12:00:00.000Z' },
    { roomId: 'archived', title: 'Archived room', revision: 1, status: 'archived', lastActivityAt: '2026-01-01T12:00:00.000Z' },
  ] }), onCollaborationRoomEvent: () => mocks.unsubscribe,
} }));

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return <button onClick={() => setLocale('en')}>English</button>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('reuses the actual activity formatter on ten rerenders and refreshes it for the locale', async () => {
  const Actual = Intl.RelativeTimeFormat;
  const constructor = vi.spyOn(Intl, 'RelativeTimeFormat').mockImplementation(function (locale, options) {
    return new Actual(locale, options);
  });
  const at = Date.now() - 180_000;
  mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'report', at,
    projection: { executionState: 'completed', summary: 'Report' } }]);
  mocks.work.mockResolvedValue({
    watch: { watchId: 'watch', workId: 'project', source: 'kswarm', status: 'active', preference: 'normal', policyRevision: 0 },
    projection: { executionState: 'completed', businessOutcome: 'unknown', summary: 'Report', lastProgressAt: null, lastHeartbeatAt: null },
  });
  const view = () => <MemoryRouter><LocaleProvider><LocaleSwitch /><ConversationActivityPanel threadId="thread" /></LocaleProvider></MemoryRouter>;
  const mounted = render(view());
  fireEvent.click(await screen.findByTestId('activity-toggle'));
  const zh = new Actual('zh-CN', { numeric: 'auto' }).format(-3, 'minute');
  expect(screen.getByTestId('activity-last-report')).toHaveTextContent(zh);
  for (let index = 0; index < 10; index++) mounted.rerender(view());
  const sameLocaleCalls = constructor.mock.calls.length;
  console.info('C_INTL_ACTIVITY', JSON.stringify({ workload: 'initial report plus ten actual component rerenders', sameLocaleCalls }));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByTestId('activity-last-report')).toHaveTextContent(new Actual('en-US', { numeric: 'auto' }).format(-3, 'minute'));
  expect(sameLocaleCalls).toBe(1);
  expect(constructor).toHaveBeenCalledTimes(2);
  mounted.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});

it('reuses the actual room formatter on ten category switches and refreshes it for the locale', async () => {
  const Actual = Intl.DateTimeFormat;
  const constructor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    return new Actual(locale, options);
  });
  const mounted = render(<MemoryRouter><LocaleProvider><LocaleSwitch /><CollaborationRoomsPage /></LocaleProvider></MemoryRouter>);
  await screen.findByText('Active room');
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false } as const;
  expect(mounted.container).toHaveTextContent(new Actual('zh', options).format(new Date('2026-01-01T12:00:00.000Z')));
  for (let index = 0; index < 10; index++) fireEvent.click(screen.getByRole('tab', { name: index % 2 ? /活跃/ : /已归档/ }));
  const sameLocaleCalls = constructor.mock.calls.length;
  console.info('C_INTL_ROOMS', JSON.stringify({ workload: 'initial load plus ten actual category switches', sameLocaleCalls }));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(mounted.container).toHaveTextContent(new Actual('en', options).format(new Date('2026-01-01T12:00:00.000Z')));
  expect(sameLocaleCalls).toBe(1);
  expect(constructor).toHaveBeenCalledTimes(2);
  mounted.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
