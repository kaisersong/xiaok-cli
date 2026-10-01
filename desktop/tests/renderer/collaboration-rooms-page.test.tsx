import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    agents: [
      { id: 'xiaok-worker', name: '小 K' },
      { id: 'agent-a', name: 'Agent A' },
    ],
  }),
}));

vi.mock('../../renderer/src/lib/desktop', () => ({
  desktop: {
    listCollaborationRooms: vi.fn(async () => ({ ok: true, rooms: [] })),
    createCollaborationRoom: vi.fn(),
    deleteCollaborationRoom: vi.fn(),
    archiveCollaborationRoom: vi.fn(),
    onCollaborationRoomEvent: vi.fn(() => () => undefined),
  },
}));

import { desktop } from '../../renderer/src/lib/desktop';
import { CollaborationRoomsPage } from '../../renderer/src/components/collaboration/CollaborationRoomsPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('CollaborationRoomsPage', () => {
  it('shows the default Xiaok agent as a checked, non-removable room member', async () => {
    render(
      <MemoryRouter>
        <LocaleProvider>
          <CollaborationRoomsPage />
        </LocaleProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '新建协作空间' }));
    const defaultAgent = screen.getByRole('checkbox', { name: /小 K/ }) as HTMLInputElement;

    expect(defaultAgent.checked).toBe(true);
    expect(defaultAgent.disabled).toBe(true);
  });
});

const mount = () => render(<MemoryRouter><LocaleProvider><CollaborationRoomsPage /></LocaleProvider></MemoryRouter>);
const rooms = [
  {roomId: 'older', title: 'Older active', status: 'active', revision: 1, lastActivityAt: '2026-01-01T12:00:00Z'},
  {roomId: 'archived', title: 'Archived room', status: 'archived', revision: 2, lastActivityAt: '2026-01-03T12:00:00Z'},
  {roomId: 'newer', title: 'Newer active', status: 'active', revision: 1, lastActivityAt: '2026-01-02T12:00:00Z'},
];
beforeEach(() => {
  vi.mocked(desktop.listCollaborationRooms).mockReset().mockResolvedValue({ok: true, rooms});
  vi.mocked(desktop.archiveCollaborationRoom).mockReset().mockResolvedValue({ok: true});
  vi.mocked(desktop.deleteCollaborationRoom).mockReset().mockResolvedValue({ok: true});
});
it('defaults to active, orders newest first, and separates archive with timestamp pills', async () => {
  mount(); await screen.findByText('Newer active');
  expect(screen.queryByText('Archived room')).toBeNull();
  const cards = screen.getAllByRole('article');
  expect(cards.map(c => c.textContent)).toEqual([expect.stringContaining('Newer active'), expect.stringContaining('Older active')]);
  expect(cards[0].querySelector('time')?.dateTime).toBe('2026-01-02T12:00:00Z');
  expect(within(cards[0]).getByText(/最后活跃/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', {name: /已归档/}));
  expect(await screen.findByText('Archived room')).toBeTruthy(); expect(screen.queryByText('Newer active')).toBeNull();
});
it('cancel leaves the space; confirmed deletion sends its revision and refreshes authoritative list', async () => {
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  fireEvent.click(within(card).getByRole('menuitem', {name: /删除/}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '取消'})); expect(desktop.deleteCollaborationRoom).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  fireEvent.click(within(card).getByRole('menuitem', {name: /删除/}));
  vi.mocked(desktop.listCollaborationRooms).mockResolvedValue({ok: true, rooms: rooms.filter(r => r.roomId !== 'newer')});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除协作空间'}));
  await waitFor(() => expect(screen.queryByText('Newer active')).toBeNull());
  expect(desktop.deleteCollaborationRoom).toHaveBeenCalledWith({roomId: 'newer', expectedRoomRevision: 1});
});
it('failed pending deletion retains room and explains archive settlement', async () => {
  vi.mocked(desktop.deleteCollaborationRoom).mockResolvedValue({ok: false, code: 'room_delete_pending'});
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  fireEvent.click(within(card).getByRole('menuitem', {name: /删除/}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除协作空间'}));
  expect(await screen.findByText(/结束协作/)).toBeTruthy(); expect(screen.getAllByText('Newer active').length).toBeGreaterThan(0);
});
it('does not resurrect a deleted card from an older in-flight focus refresh', async () => {
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  let resolve!: (value: unknown) => void;
  vi.mocked(desktop.listCollaborationRooms).mockImplementationOnce(() => new Promise(r => {resolve = r as never;}));
  fireEvent.focus(window);
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  fireEvent.click(within(card).getByRole('menuitem', {name: /删除/}));
  vi.mocked(desktop.listCollaborationRooms).mockResolvedValue({ok: true, rooms: []});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除协作空间'}));
  await waitFor(() => expect(screen.queryByText('Newer active')).toBeNull());
  resolve({ok: true, rooms}); await new Promise(r => setTimeout(r, 0));
  expect(screen.queryByText('Newer active')).toBeNull();
});

it('more menu archives active rooms and moves them to the archive category', async () => {
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  expect(within(card).queryByRole('button', {name: /删除/})).toBeNull();
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  vi.mocked(desktop.listCollaborationRooms).mockResolvedValue({ok: true, rooms: rooms.map(r => r.roomId === 'newer' ? {...r, status: 'archiving'} : r)});
  fireEvent.click(within(card).getByRole('menuitem', {name: '归档'}));
  await waitFor(() => expect(screen.queryByText('Newer active')).toBeNull());
  expect(desktop.archiveCollaborationRoom).toHaveBeenCalledWith({roomId: 'newer', expectedRoomRevision: 1});
  fireEvent.click(screen.getByRole('tab', {name: /已归档/}));
  expect(await screen.findByText('Newer active')).toBeTruthy(); expect(screen.getByText('归档中')).toBeTruthy();
});

it('more menu closes with Escape or an outside click without performing a mutation', async () => {
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  const trigger = within(card).getByRole('button', {name: '更多操作'});
  fireEvent.click(trigger); expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'}); expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger); fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  expect(desktop.archiveCollaborationRoom).not.toHaveBeenCalled(); expect(desktop.deleteCollaborationRoom).not.toHaveBeenCalled();
});
it('revision conflict requires a fresh selection before confirmation can be retried', async () => {
  vi.mocked(desktop.deleteCollaborationRoom).mockResolvedValue({ok: false, code: 'room_revision_conflict'});
  mount(); const card = (await screen.findByText('Newer active')).closest('article')!;
  fireEvent.click(within(card).getByRole('button', {name: '更多操作'}));
  fireEvent.click(within(card).getByRole('menuitem', {name: /删除/}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除协作空间'}));
  expect(await screen.findByText(/空间已发生变化/)).toBeTruthy();
  expect((within(screen.getByRole('dialog')).getByRole('button', {name: '删除协作空间'}) as HTMLButtonElement).disabled).toBe(true);
});

it('all collaboration list color variables exist in the production theme', async () => {
  const {readFileSync} = await import('node:fs');
  const {resolve} = await import('node:path');
  const source = readFileSync(resolve('renderer/src/components/collaboration/CollaborationRoomsPage.tsx'), 'utf8');
  const theme = readFileSync(resolve('renderer/src/styles/index.css'), 'utf8');
  const references = [...new Set([...source.matchAll(/var\((--[a-z][\w-]*)/g)].map(match => match[1]))];
  const declarations = new Set([...theme.matchAll(/(--[a-z][\w-]*)\s*:/g)].map(match => match[1]));
  expect(references.filter(name => !declarations.has(name))).toEqual([]);
});
