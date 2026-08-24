import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputReader } from '../../src/ui/input.js';
import { createTtyHarness, type TtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';

describe('Ctrl+O transcript dispatch', () => {
  let reader: InputReader;
  let harness: TtyHarness;

  beforeEach(() => {
    reader = new InputReader();
    harness = createTtyHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it('invokes the registered toggle-transcript handler', async () => {
    const handler = vi.fn();
    reader.setToggleTranscriptHandler(handler);

    const pending = reader.read('> ');
    harness.send('\x0f');
    await waitFor(() => handler.mock.calls.length === 1);

    harness.send('done');
    harness.send('\r');
    await expect(pending).resolves.toBe('done');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never leaks the 0x0f byte into the draft', async () => {
    reader.setToggleTranscriptHandler(vi.fn());

    const pending = reader.read('> ');
    harness.send('ab');
    harness.send('\x0f');
    harness.send('c');
    harness.send('\r');

    await expect(pending).resolves.toBe('abc');
  });

  it('swallows Ctrl+O when no handler is registered', async () => {
    const pending = reader.read('> ');
    harness.send('hello');
    harness.send('\x0f');
    harness.send('\r');

    await expect(pending).resolves.toBe('hello');
  });

  it('reports handler rejections without breaking the read loop', async () => {
    const handler = vi.fn(async () => {
      throw new Error('pager exploded');
    });
    reader.setToggleTranscriptHandler(handler);

    const pending = reader.read('> ');
    harness.send('\x0f');
    await waitFor(() => handler.mock.calls.length === 1);
    harness.send('still alive');
    harness.send('\r');

    await expect(pending).resolves.toBe('still alive');
  });
});

describe('InputReader.suspendForExternalProcess', () => {
  let reader: InputReader;
  let harness: TtyHarness;

  beforeEach(() => {
    reader = new InputReader();
    harness = createTtyHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it('detaches the stdin data listener and re-attaches on resume', async () => {
    const pending = reader.read('> ');
    expect(harness.emitter.listenerCount('data')).toBe(1);

    const suspension = reader.suspendForExternalProcess();
    expect(harness.emitter.listenerCount('data')).toBe(0);

    suspension.resume();
    expect(harness.emitter.listenerCount('data')).toBe(1);

    harness.send('back');
    harness.send('\r');
    await expect(pending).resolves.toBe('back');
  });

  it('preserves the pending draft across suspend and resume', async () => {
    const pending = reader.read('> ');
    harness.send('draft text');

    const suspension = reader.suspendForExternalProcess();
    // Keys arriving while suspended must not reach the draft.
    harness.send('LEAKED');
    suspension.resume();

    harness.send('!');
    harness.send('\r');
    await expect(pending).resolves.toBe('draft text!');
  });

  it('leaves raw mode while suspended and restores it on resume', async () => {
    const setRawMode = process.stdin.setRawMode as unknown as ReturnType<typeof vi.fn>;
    const pending = reader.read('> ');
    setRawMode.mockClear();

    const suspension = reader.suspendForExternalProcess();
    expect(setRawMode).toHaveBeenCalledWith(false);

    setRawMode.mockClear();
    suspension.resume();
    expect(setRawMode).toHaveBeenCalledWith(true);

    harness.send('after resume');
    harness.send('\r');
    await expect(pending).resolves.toBe('after resume');
  });

  it('is idempotent for repeated suspend calls', async () => {
    const pending = reader.read('> ');

    const first = reader.suspendForExternalProcess();
    const second = reader.suspendForExternalProcess();
    expect(harness.emitter.listenerCount('data')).toBe(0);

    second.resume();
    first.resume();
    expect(harness.emitter.listenerCount('data')).toBe(1);

    harness.send('ok');
    harness.send('\r');
    await expect(pending).resolves.toBe('ok');
  });

  it('is idempotent for repeated resume calls', async () => {
    const pending = reader.read('> ');
    const suspension = reader.suspendForExternalProcess();

    suspension.resume();
    suspension.resume();
    suspension.resume();
    expect(harness.emitter.listenerCount('data')).toBe(1);

    harness.send('once');
    harness.send('\r');
    await expect(pending).resolves.toBe('once');
  });

  it('is a no-op when no read loop is active', () => {
    expect(harness.emitter.listenerCount('data')).toBe(0);
    const suspension = reader.suspendForExternalProcess();
    expect(() => suspension.resume()).not.toThrow();
    expect(harness.emitter.listenerCount('data')).toBe(0);
  });

  it('drops the suspend hooks once the read loop finishes', async () => {
    const pending = reader.read('> ');
    harness.send('submitted');
    harness.send('\r');
    await expect(pending).resolves.toBe('submitted');

    const suspension = reader.suspendForExternalProcess();
    suspension.resume();
    expect(harness.emitter.listenerCount('data')).toBe(0);
  });
});
