import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOwnedServiceChildCloseTracker } from '../../electron/owned-service-child-close.js';

class ControlledChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn(() => true);
  asChild() { return this as unknown as ChildProcess; }
}
afterEach(() => vi.useRealTimers());

describe('owned service direct child close observation', () => {
  it.each([5_000, 3_000])('waits actual close beyond exit and signal with grace %i', async (grace) => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(child.asChild(), grace);
    const closing = tracker.closeAll();
    expect(tracker.closeAll()).toBe(closing);
    let settled = false;
    void closing.then(() => { settled = true; });
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(grace);
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', 0, null);
    await closing;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => tracker.track(new ControlledChild().asChild(), grace)).toThrow(/closed/);
  });

  it.each([5_000, 3_000])('rejects at grace %i plus 3s when exit never produces close, without signaling the exited child', async grace => {
    vi.useFakeTimers(); const child = new ControlledChild(); const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(child.asChild(), grace); child.emit('exit', 0, null);
    const closing = tracker.closeAll(); const failure = expect(closing).rejects.toThrow(/unconfirmed/);
    let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(grace + 2_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await failure;
    expect(child.kill).not.toHaveBeenCalled(); expect(tracker.closeAll()).toBe(closing); expect(vi.getTimerCount()).toBe(0);
  });

  it('retains an exited child whose old service pointer was cleared', async () => {
    const child = new ControlledChild();
    const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(child.asChild(), 5_000);
    child.emit('exit', 0, null);
    const closing = tracker.closeAll();
    let settled = false;
    void closing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    await closing;
  });

  it('rejects cached closure when SIGKILL still has no close and drains siblings', async () => {
    vi.useFakeTimers();
    const stuck = new ControlledChild();
    const other = new ControlledChild();
    const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(stuck.asChild(), 5_000);
    tracker.track(other.asChild(), 3_000);
    const closing = tracker.closeAll();
    const rejected = expect(closing).rejects.toThrow(/unconfirmed/);
    other.emit('exit', 0, null);
    other.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stuck.kill).toHaveBeenLastCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    expect(tracker.closeAll()).toBe(closing);
    expect(vi.getTimerCount()).toBe(0);
    stuck.emit('close', null, 'SIGKILL');
    await expect(tracker.closeAll()).rejects.toThrow(/unconfirmed/);
  });

  it('does not treat kill false or throw as successful closure', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    child.kill.mockImplementationOnce(() => false).mockImplementationOnce(() => { throw Error('kill failed'); });
    const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(child.asChild(), 3_000);
    const closing = tracker.closeAll();
    const rejected = expect(closing).rejects.toThrow(/unconfirmed/);
    await vi.advanceTimersByTimeAsync(6_000);
    await rejected;
    child.emit('close', null, null);
  });

  it('waits the actual Node child close event and captures its output tail', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{process.stdout.write('tail\\n');process.exit(0)});process.stdout.write('ready\\n');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    const tracker = createOwnedServiceChildCloseTracker();
    tracker.track(child, 5_000);
    let output = '';
    child.stdout!.on('data', chunk => { output += String(chunk); });
    const ready = once(child.stdout!, 'data');
    let actualClose = false;
    child.once('close', () => { actualClose = true; });
    try {
      await ready;
      await tracker.closeAll();
      expect(actualClose).toBe(true);
      expect(output).toContain('ready');
      // Windows force-terminates SIGTERM and does not invoke the JS handler.
      if (process.platform !== 'win32') expect(output).toContain('tail');
    } finally { if (!actualClose) child.kill('SIGKILL'); }
  }, 15_000);
  it.each(['throw', 'false'])('retains a %s signal failure even if close later arrives', async mode => {
    const child = new ControlledChild(); const sibling = new ControlledChild();
    child.kill.mockImplementationOnce(() => { if (mode === 'throw') throw Error('TERM failed'); return false; });
    const tracker = createOwnedServiceChildCloseTracker(); tracker.track(child.asChild(), 5_000); tracker.track(sibling.asChild(), 3_000);
    const closing = tracker.closeAll(); const failure = expect(closing).rejects.toThrow(/unconfirmed/); await Promise.resolve();
    child.emit('close', 0, null); sibling.emit('close', 0, null); await failure;
    expect(tracker.closeAll()).toBe(closing); expect(sibling.kill).toHaveBeenCalledWith('SIGTERM');
  });

});
