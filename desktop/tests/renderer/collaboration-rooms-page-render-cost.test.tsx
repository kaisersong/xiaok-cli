import { afterEach, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({useKSwarm: () => ({ agents: [] })}));
vi.mock('../../renderer/src/lib/desktop', () => ({ desktop: {
  listCollaborationRooms: vi.fn(async () => ({ ok: true, rooms: Array.from({ length: 60 }, (_, index) => ({
    roomId: String(index), title: `Room ${index}`, revision: 1, status: index % 2 ? 'archived' : 'active',
    lastActivityAt: new Date(Date.UTC(2026, 0, 1, index % 24)).toISOString(),
  })) })), onCollaborationRoomEvent: vi.fn(() => () => {}),
} }));
import { CollaborationRoomsPage } from '../../renderer/src/components/collaboration/CollaborationRoomsPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
afterEach(() => { cleanup(); window.localStorage.clear(); });
it('profiles actual production room rendering across unchanged category switches', async () => {
  const durations: number[] = [];
  render(<MemoryRouter><LocaleProvider><Profiler id="production-rooms" onRender={(_id, _phase, duration) => durations.push(duration)}>
    <CollaborationRoomsPage />
  </Profiler></LocaleProvider></MemoryRouter>);
  await screen.findByText('Room 0');
  const coldDurations = [...durations];
  const active = screen.getByRole('tab', { name: /活跃/ });
  const archived = screen.getByRole('tab', { name: /已归档/ });
  for (let index = 0; index < 10; index++) fireEvent.click(index % 2 ? active : archived);
  durations.length = 0;
  for (let index = 0; index < 60; index++) fireEvent.click(index % 2 ? active : archived);
  expect(durations).toHaveLength(60);
  expect(screen.getAllByRole('article')).toHaveLength(30);
  const sorted = [...durations].sort((a, b) => a - b);
  const report = { scenario: 'actual production React component; synthetic 60 room inputs, 30 visible; development Profiler, not installed Electron UI',
    sourceSha: createHash('sha256').update(readFileSync('renderer/src/components/collaboration/CollaborationRoomsPage.tsx')).digest('hex'),
    coldDurations, coldCommitTotalMs: coldDurations.reduce((sum, value) => sum + value, 0),
    samples: durations.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], durations };
  if (process.env.XIAOK_ROOM_RENDER_BENCHMARK_OUTPUT) writeFileSync(process.env.XIAOK_ROOM_RENDER_BENCHMARK_OUTPUT, JSON.stringify(report, null, 2));
});
