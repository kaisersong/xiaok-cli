import {afterEach, describe, expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {awaitOwnerStatus} from '../../support/activity-owner-teardown.js';

// The event leaf is injected; actual files and the real helper are used.
// This is a unit contract, never evidence of kernel event delivery or Native qualification.
describe('owner status directory-event branch (injected unit)', () => {
  const roots: string[] = [];
  afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
  function fixture(initialPid: number | null) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'owner-status-event-')));
    roots.push(root);
    const dataRoot = join(root, 'state'); mkdirSync(dataRoot);
    const file = join(dataRoot, 'activity-owner.status.json');
    const expected = {pid: 41009, ownerEpoch: 'expected', rootHash: 'h'};
    function publish(value: typeof expected) { writeFileSync(file + '.tmp', JSON.stringify(value)); renameSync(file + '.tmp', file); }
    if (initialPid !== null) publish({...expected, pid: initialPid});
    const events = new EventEmitter(); let closed = 0, watched = 0;
    const watcher = Object.assign(events, {close() { closed++; events.removeAllListeners(); }});
    const watchDir = (dir: string, changed: () => void) => {
      expect(dir).toBe(dataRoot); watched++; events.on('change', changed); return watcher;
    };
    return {dataRoot, expected, publish, events, watchDir, get closed() { return closed; }, get watched() { return watched; }};
  }

  it.each(['missing status', 'foreign pid'] as const)('responds to a controlled change from %s', async mode => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate']});
    try {
      const f = fixture(mode === 'missing status' ? null : 99999);
      let resolved = false;
      const pending = awaitOwnerStatus(f.dataRoot, f.expected.pid, 5000, f.watchDir).then(value => { resolved = true; return value; });
      expect(f.watched).toBe(1);
      f.events.emit('change'); // Missing/foreign status cannot resolve even after an event.
      await Promise.resolve(); expect(resolved).toBe(false); expect(f.closed).toBe(0);
      f.publish(f.expected);
      // The matching file already exists, but no event and no timer was delivered.
      await Promise.resolve(); expect(resolved).toBe(false);
      f.events.emit('change');
      expect(await pending).toEqual(f.expected);
      expect(f.closed).toBe(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('retains the existing single real deadline read when no event arrives', async () => {
    const f = fixture(null);
    const pending = awaitOwnerStatus(f.dataRoot, f.expected.pid, 25, f.watchDir);
    f.publish(f.expected); // Deliberately do not emit a directory event.
    expect(await pending).toEqual(f.expected);
    expect(f.watched).toBe(1); expect(f.closed).toBe(1);
  });
});
