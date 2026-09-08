// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { rmSync } from 'node:fs';
import { loadVerifierContract, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('R4 fixed verifier input errors remain distinct from malformed transport', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); });
  async function setup() {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const verifier = new helper.api.DeliveryVerifier();
    const pending: Promise<unknown>[] = []; cleanup.push(async () => { await Promise.allSettled(pending); });
    const verify = (snapshot = snapshotFixture()) => verifier.verify(snapshot, {
      signal: new AbortController().signal, deadline: performance.now() + 2000, trackPending: raw => { pending.push(raw); },
    });
    return { verify, pending };
  }

  it.each(['empty-task-id', 'wrong-prompt-type'] as const)('D13 locally captured %s preserves verifier_input_invalid without starting a Worker', async kind => {
    const f = await setup(), post = vi.spyOn(Worker.prototype, 'postMessage');
    const snapshot = snapshotFixture(kind === 'empty-task-id' ? { taskId: '' } : { prompt: 42 } as unknown as Partial<TaskSnapshot>);
    await expect(f.verify(snapshot)).rejects.toMatchObject({ code: 'verifier_input_invalid' });
    expect(post).not.toHaveBeenCalled(); expect(f.pending).toHaveLength(0);
  });

  it('D7 a real fixed CPU Worker rejects malformed input, and the parent fences its unbound fallback request ID as protocol_error', async () => {
    const f = await setup(), original = Worker.prototype.postMessage, frames: unknown[] = [], exits: number[] = [];
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function(this: Worker, value, ...rest) {
      this.on('message', frame => frames.push(JSON.parse(String(frame)))); this.once('exit', code => exits.push(code));
      // Corrupt only the test-owned transport input. The actual fixed production
      // Worker validates it and creates the error frame; no worker reply mock.
      const request = JSON.parse(String(value)); request.prompt = 42;
      return original.call(this, JSON.stringify(request) + '\n', ...rest);
    });
    await expect(f.verify()).rejects.toMatchObject({ code: 'verifier_protocol_error' });
    await Promise.allSettled(f.pending);
    expect(frames).toHaveLength(1); expect(frames[0]).toMatchObject({ result: { kind: 'error', code: 'verifier_input_invalid' } });
    expect(exits).toHaveLength(1);
  });

  it('D7 the parent preserves input_invalid in a controlled, correctly bound fixed error frame', async () => {
    const f = await setup(), original = Worker.prototype.emit; let supplied = 0;
    vi.spyOn(Worker.prototype, 'emit').mockImplementation(function(this: Worker, event, ...args) {
      if (event === 'message') {
        // Deliberate transport fault injection: tests the real parent parser
        // and validator, not a claimed native valid-request error population.
        const frame = JSON.parse(String(args[0]));
        frame.result = { kind: 'error', code: 'verifier_input_invalid' }; supplied++;
        args[0] = JSON.stringify(frame) + '\n';
      }
      return original.call(this, event, ...args);
    });
    await expect(f.verify()).rejects.toMatchObject({ code: 'verifier_input_invalid' });
    await Promise.allSettled(f.pending); expect(supplied).toBe(1);
  });

  it.each(['invalid-json', 'wrong-request', 'unknown-key'] as const)('D7 malformed %s reply remains verifier_protocol_error, not an input rejection', async kind => {
    const f = await setup(), original = Worker.prototype.emit;
    vi.spyOn(Worker.prototype, 'emit').mockImplementation(function(this: Worker, event, ...args) {
      if (event === 'message') {
        const frame = JSON.parse(String(args[0]));
        if (kind === 'wrong-request') frame.requestId = 'foreign';
        if (kind === 'unknown-key') frame.unknown = true;
        args[0] = kind === 'invalid-json' ? '{\n' : JSON.stringify(frame) + '\n';
      }
      return original.call(this, event, ...args);
    });
    await expect(f.verify()).rejects.toMatchObject({ code: 'verifier_protocol_error' });
    await Promise.allSettled(f.pending);
  });
});
