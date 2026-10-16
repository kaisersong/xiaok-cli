import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';
import { ownPendingClose } from '../../../src/runtime/conversation-activity/pending-close-owner.js';

it('actual public Client/Stdio: close-before-connect waits that genuine Client and its owned child exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r237-owned-stdio-'));
  const ready = join(root, 'ready.json'), release = join(root, 'release');
  const closed = join(root, 'closed.json'), exited = join(root, 'exited.json');

  let pid: number | null = null, completed = false, hadFailure = false;
  let originalFailure: unknown;
  let observedAll: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
  const script = readFileSync(join(process.cwd(), 'tests/support/r237-owned-mcp-stdio.mjs'), 'utf8');
  const pending = createMcpClientConnection('r237-owned-stdio', {
    type: 'stdio', command: process.execPath, args: ['--input-type=module', '--eval', script],
    env: { R237_READY_FILE: ready, R237_RELEASE_FILE: release, R237_CLOSED_FILE: closed, R237_EXIT_FILE: exited },
    protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000 },
  }, { cwd: process.cwd(), clientName: 'r237-owned-public-close' });
  const owner = ownPendingClose(pending);
  const closing = owner.close(), observed = closing.then(() => { completed = true; });
  // Attach rejection observation now; actual rejection remains a test failure.
  observedAll = Promise.allSettled([pending, closing, observed]);
    await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 5000 });
    expect(owner.settled).toBe(pending); expect(owner.close()).toBe(closing); expect(completed).toBe(false);
    writeFileSync(release, 'release own initialization', { mode: 0o600 });
    const connection = await pending; pid = connection.getChildPid();
    expect(connection.protocolEra).toBe('modern'); expect(pid).not.toBeNull();
    expect(JSON.parse(readFileSync(ready, 'utf8'))).toEqual({ pid });
    await closing; expect(completed).toBe(true);
    if (pid === null) throw Error('actual owned stdio PID missing');
    let absence: unknown;
    try { process.kill(pid, 0); } catch (error) { absence = error; }
    expect(absence).toMatchObject({ code: 'ESRCH' });
    expect(JSON.parse(readFileSync(closed, 'utf8'))).toEqual({ pid, observed: 'stdin-end-and-public-handle-close' });
    expect(JSON.parse(readFileSync(exited, 'utf8'))).toEqual({ pid, code: 0 });
  } catch (error) { hadFailure = true; originalFailure = error; throw error; } finally {
    const cleanupErrors: unknown[] = [];
    try { writeFileSync(release, 'release own initialization', { mode: 0o600 }); } catch (error) { cleanupErrors.push(error); }
    const outcomes = await (observedAll ?? Promise.resolve([]));
    if (cleanupErrors.length || outcomes.some(result => result.status === 'rejected')) throw new AggregateError([...(hadFailure ? [originalFailure] : []), ...cleanupErrors, ...outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : [])], 'owned public stdio control failed');
    if (pid === null) throw new AggregateError([...(hadFailure ? [originalFailure] : []), Error('actual owned PID unknown; root retained')], 'owned stdio cleanup unconfirmed');
    if (pid !== null) {
      try { process.kill(pid, 0); throw Error('owned stdio process remains; keep root'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    rmSync(root, { recursive: true });
  }
}, 15000);
