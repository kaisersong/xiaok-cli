import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateStalePortOwner } from '../../electron/kswarm-service.js';
afterEach(() => vi.useRealTimers());
function fixture() { return { findOwner: vi.fn(async (): Promise<number | null> => 55_001), signalProcess: vi.fn(() => true) as unknown as ReturnType<typeof vi.fn> & typeof process.kill }; }
describe('actual stale port termination control flow', () => {
  it('does not send TERM when discovery returns after seal', async () => {
    const io = fixture(); let release!: (value: number) => void;
    io.findOwner.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const abort = new AbortController(); const pending = terminateStalePortOwner(4400, 55_001, abort.signal, io);
    abort.abort(); release(55_001); expect(await pending).toBe('aborted'); expect(io.signalProcess).not.toHaveBeenCalled();
  });
  it('never signals a replacement listener', async () => {
    const io = fixture(); io.findOwner.mockResolvedValue(55_002);
    expect(await terminateStalePortOwner(4400, 55_001, new AbortController().signal, io)).toBe('owner_changed');
    expect(io.signalProcess).not.toHaveBeenCalled();
  });
  it('stops before probe and KILL after TERM then seal', async () => {
    vi.useFakeTimers(); const io = fixture(); const abort = new AbortController();
    const pending = terminateStalePortOwner(4400, 55_001, abort.signal, io);
    await vi.advanceTimersByTimeAsync(0); expect(io.signalProcess).toHaveBeenCalledWith(55_001, 'SIGTERM');
    abort.abort(); await vi.advanceTimersByTimeAsync(4_000);
    expect(await pending).toBe('aborted'); expect(io.signalProcess).toHaveBeenCalledTimes(1);
  });
  it.each([null, 55_002])('revalidates owner before KILL: %s', async replacement => {
    vi.useFakeTimers(); const io = fixture(); io.findOwner.mockResolvedValueOnce(55_001).mockResolvedValue(replacement);
    const pending = terminateStalePortOwner(4400, 55_001, new AbortController().signal, io);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe(replacement === null ? 'stopped' : 'owner_changed');
    expect(io.signalProcess).not.toHaveBeenCalledWith(55_001, 'SIGKILL');
  });
  it('reports confirmed absence of original PID without KILL', async () => {
    vi.useFakeTimers(); const io = fixture();
    io.signalProcess.mockImplementation((_pid: number, signal: unknown) => { if (signal === 0) throw Object.assign(Error('gone'), { code: 'ESRCH' }); return true; });
    const pending = terminateStalePortOwner(4400, 55_001, new AbortController().signal, io);
    await vi.advanceTimersByTimeAsync(200); expect(await pending).toBe('stopped'); expect(io.signalProcess).not.toHaveBeenCalledWith(55_001, 'SIGKILL');
  });
});
