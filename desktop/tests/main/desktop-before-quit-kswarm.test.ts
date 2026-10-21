import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DesktopShutdownCoordinator } from '../../electron/desktop-shutdown-coordinator.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { UpdaterHandoffStateMachine } from '../../electron/updater-handoff.js';
import { registerDesktopBeforeQuit, disposeDesktopLifetimeSteps } from '../../electron/desktop-before-quit.js';

function setup(close: () => Promise<void>) {
  const app = new EventEmitter(); const reports: unknown[] = []; const bridge = vi.fn(async () => {});
  const steps = [{ name: 'kswarm-instance', run: close }, { name: 'bridge', run: bridge }];
  const continuation = vi.fn(() => { app.emit('before-quit', { preventDefault: recursivePrevent }); });
  const recursivePrevent = vi.fn();
  const coordinator = new DesktopShutdownCoordinator({
    gate: new DesktopShutdownGate(),
    providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) },
    ingressOwners: [], durableStores: [], destroyWindows() {}, releaseMainSourcePin: async () => {},
    disposeLifetimeResources: () => disposeDesktopLifetimeSteps(steps, (name, error) => reports.push({ name, error })), continuation,
  });
  const handoff = new UpdaterHandoffStateMachine({ platformClass: 'base', invokeWrapper() { app.emit('before-quit', { preventDefault: updaterPrevent }); } });
  const updaterPrevent = vi.fn();
  const completeUpdater = vi.fn(); registerDesktopBeforeQuit(app, coordinator, handoff, completeUpdater);
  return { app, coordinator, continuation, recursivePrevent, reports, bridge, handoff, updaterPrevent, completeUpdater };
}
describe('production registered before-quit handler', () => {
  it('waits the same close on repeated real events before continuation reenters and passes', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); const close = vi.fn(() => pending);
    const f = setup(close); const prevent = vi.fn(); f.app.emit('before-quit', { preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(1);
    const first = f.coordinator.onBeforeQuit().shutdown; f.app.emit('before-quit', { preventDefault: prevent });
    expect(f.coordinator.onBeforeQuit().shutdown).toBe(first); expect(prevent).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1)); expect(f.continuation).not.toHaveBeenCalled();
    release(); await first; expect(f.continuation).toHaveBeenCalledTimes(1); expect(f.recursivePrevent).not.toHaveBeenCalled();
    expect(f.bridge).toHaveBeenCalledTimes(1); expect(f.completeUpdater).toHaveBeenCalledTimes(1);
  });
  it('runs original updater handoff through that registered event and records failed child close', async () => {
    const failure = Error('owned_service_child_close_unconfirmed');
    const f = setup(async () => { throw failure; });
    f.handoff.begin(); expect(f.updaterPrevent).toHaveBeenCalledTimes(1);
    const report = await f.coordinator.onBeforeQuit().shutdown;
    expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(report.cleanupFailed.join(' ')).toContain('owned_service_child_close_unconfirmed');
    expect(f.handoff.projection().status).toBe('install_handed_off');
    expect(f.reports).toEqual([{ name: 'kswarm-instance', error: failure }]);
    expect(f.bridge).toHaveBeenCalledTimes(1); expect(f.continuation).toHaveBeenCalledTimes(1);
    expect(f.recursivePrevent).not.toHaveBeenCalled();
  });
  it.each(['commit', 'completion'])('still takes shutdown ownership when updater %s throws', async mode => {
    const f = setup(async () => {});
    if (mode === 'commit') vi.spyOn(f.handoff, 'commitHandoffOnBeforeQuit').mockImplementation(() => { throw Error('handoff failure'); });
    else f.completeUpdater.mockImplementation(() => { throw Error('updater diagnostic failure'); });
    const prevent = vi.fn(); expect(() => f.app.emit('before-quit', { preventDefault: prevent })).not.toThrow();
    expect(prevent).toHaveBeenCalledTimes(1); await f.coordinator.onBeforeQuit().shutdown;
    expect(f.bridge).toHaveBeenCalledTimes(1); expect(f.continuation).toHaveBeenCalledTimes(1);
  });

  it('continues later bridge and final cleanup even if failure reporting itself throws', async () => {
    const bridge = vi.fn(async () => {}); const final = vi.fn(async () => {});
    await expect(disposeDesktopLifetimeSteps([{ name: 'bad', run: async () => { throw Error('bad'); } }, { name: 'bridge', run: bridge }, { name: 'final', run: final }], () => { throw Error('logger failed'); })).rejects.toThrow(/bad/);
    expect(bridge).toHaveBeenCalledTimes(1); expect(final).toHaveBeenCalledTimes(1);
  });

});
