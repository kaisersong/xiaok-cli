import { describe, it, expect, vi } from 'vitest';
import { createTtyHarness } from '../support/tty.js';

describe('TTY harness Node stream contracts', () => {
  it('invokes successful write callbacks asynchronously with both overloads', async () => {
    const harness = createTtyHarness();
    try {
      const callback = vi.fn();
      process.stdout.write('first', callback);
      process.stdout.write('second', 'utf8', callback);
      expect(callback).not.toHaveBeenCalled();
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(callback).toHaveBeenCalledTimes(2);
      expect(harness.output.raw).toBe('firstsecond');
    } finally { harness.restore(); }
  });
  it('supports callbacks for captured stderr and retains synchronous write failure', async () => {
    const harness = createTtyHarness(80, 24, { captureStderr: true });
    try {
      const callback = vi.fn();
      process.stderr.write('error output', 'utf8', callback);
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(callback).toHaveBeenCalledTimes(1);
      const failure = Object.assign(new Error('simulated broken pipe'), { code: 'EPIPE' });
      harness.failNextStdoutWrite(failure);
      const failedWriteCallback = vi.fn();
      expect(() => process.stdout.write('failed output', failedWriteCallback)).toThrow(failure);
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(failedWriteCallback).not.toHaveBeenCalled();
      expect(harness.output.raw).toBe('error output');
    } finally { harness.restore(); }
  });
  it('removes fake stdin listeners through off and restores the original method', () => {
    const originalOff = process.stdin.off;
    const harness = createTtyHarness();
    try {
      const listener = vi.fn();
      process.stdin.on('end', listener);
      expect(harness.emitter.listenerCount('end')).toBe(1);
      process.stdin.off('end', listener);
      expect(harness.emitter.listenerCount('end')).toBe(0);
      harness.emitter.emit('end');
      expect(listener).not.toHaveBeenCalled();
      process.stdin.once('end', listener);
      process.stdin.off('end', listener);
      expect(harness.emitter.listenerCount('end')).toBe(0);
      harness.emitter.emit('end');
      expect(listener).not.toHaveBeenCalled();
    } finally { harness.restore(); }
    expect(process.stdin.off).toBe(originalOff);
  });
});
