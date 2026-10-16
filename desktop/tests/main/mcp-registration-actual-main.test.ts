// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { ShutdownReport } from '../../electron/desktop-shutdown-coordinator.js';
import { withActualMainRegistration, turn } from './mcp-registration-actual-main-fixture.js';

it('A1 actual Main normal lifetime awaits bridge stop before same returned MCP dispose, before later ordinary/final callbacks', async () => {
  await withActualMainRegistration(async f => {
    let reentered: Promise<ShutdownReport> | undefined;
    f.hooks.dispose = () => { reentered = f.close(); };
    const owner = f.start(), fallback = f.finalRegistration();
    expect(fallback.run).toBe(owner.dispose);
    f.registration.resolve(f.returned); expect(await owner.registered).toBe(true);
    const closing = f.close(); expect(f.close()).toBe(closing);
    await vi.waitFor(() => expect(f.count('callback:bridge.stop')).toBe(1));
    await turn();
    expect(f.index('callback:provider.dispose')).toBeLessThan(f.index('callback:bridge.stop'));
    expect(f.count('callback:mcp.dispose')).toBe(0);
    expect(f.count('own:ordinary.after-main')).toBe(0);
    f.stop.resolve();
    await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1));
    const same = owner.dispose(); expect(fallback.run()).toBe(same); expect(reentered).toBe(closing);
    expect(f.count('own:ordinary.after-main')).toBe(0); expect(f.count('own:final')).toBe(0);
    expect(f.gate.outstanding).toBe(0); f.disposal.resolve();
    const report = await closing; expect(report.cleanupFailed).toEqual([]);
    expect(f.index('callback:bridge.stop')).toBeLessThan(f.index('callback:mcp.dispose'));
    expect(f.index('callback:mcp.dispose')).toBeLessThan(f.index('own:ordinary.after-main'));
    expect(f.index('own:ordinary.after-main')).toBeLessThan(f.index('own:final'));
    expect(f.count('callback:mcp.dispose')).toBe(1); expect(f.count('own:continuation')).toBe(1);
    expect(f.disposeReceivers).toEqual([undefined]);
  }, { holdStop: true, holdDispose: true });
}, 15000);

it('A2 actual Main held late registration blocks real gate drain; close then awaits that same returned dispose without starting a bridge', async () => {
  await withActualMainRegistration(async f => {
    const owner = f.start(), fallback = f.finalRegistration(), closing = f.close(); let finished = false;
    void closing.then(() => { finished = true; }); await turn();
    expect(f.gate.isOpen).toBe(false); expect(f.gate.outstanding).toBe(1); expect(finished).toBe(false);
    expect(f.count('own:store.close')).toBe(0); expect(f.count('callback:provider.dispose')).toBe(0);
    expect(f.count('callback:bridge.stop')).toBe(0); expect(f.count('callback:mcp.dispose')).toBe(0);
    f.registration.resolve(f.returned); expect(await owner.registered).toBe(true);
    await vi.waitFor(() => expect(f.count('callback:mcp.dispose')).toBe(1));
    expect(f.gate.outstanding).toBe(0); expect(f.count('callback:bridge.start')).toBe(0); expect(finished).toBe(false);
    expect(fallback.run()).toBe(owner.dispose()); f.disposal.resolve();
    const report = await closing; expect(report.ordinaryDrained).toBe(true); expect(report.cleanupFailed).toEqual([]);
    expect(f.count('callback:mcp.dispose')).toBe(1); expect(f.count('own:continuation')).toBe(1);
  }, { holdDispose: true });
}, 15000);

it('A3 actual callsite owns real writer/final fallback before producer-prefix reentrant close and retains method receiver', async () => {
  await withActualMainRegistration(async f => {
    let prefix: unknown, closing: Promise<ShutdownReport> | undefined;
    f.hooks.register = () => {
      prefix = { outstanding: f.gate.outstanding, finalNames: f.finalSteps.map(step => step.name) };
      closing = f.close();
    };
    const owner = f.start();
    expect(prefix).toEqual({ outstanding: 1, finalNames: ['mcp-tools-registration', 'mobile-gateway-stop', 'own-final-sentinel'] });
    if (!closing) throw Error('actual_prefix_close_missing'); expect(f.close()).toBe(closing);
    f.registration.resolve(f.returned); expect(await owner.registered).toBe(true); await closing;
    expect(f.registrationReceivers).toEqual([f.registrationCarrier]); expect(f.gate.outstanding).toBe(0);
    expect(f.count('callback:bridge.start')).toBe(0); expect(f.count('callback:mcp.dispose')).toBe(1);
    expect(f.index('callback:bridge.stop')).toBeLessThan(f.index('callback:mcp.dispose'));
  });
}, 15000);

it('A4 actual callsite early final fallback survives omitted later normal-cleanup installation', async () => {
  await withActualMainRegistration(async f => {
    const owner = f.start({ installNormal: false }), fallback = f.finalRegistration();
    expect(fallback.run).toBe(owner.dispose); f.registration.resolve(f.returned); await owner.registered;
    const report = await f.close(); expect(report.cleanupFailed).toEqual([]);
    expect(f.count('callback:provider.dispose')).toBe(0); expect(f.count('callback:bridge.stop')).toBe(0);
    expect(f.count('callback:mcp.dispose')).toBe(1);
    expect(f.index('own:ordinary.after-main')).toBeLessThan(f.index('callback:mcp.dispose'));
    expect(f.index('callback:mcp.dispose')).toBeLessThan(f.index('own:final'));
  });
}, 15000);

it('A5 actual kswarm lifetime stop rejection does not skip same MCP fallback in real independent step traversal', async () => {
  await withActualMainRegistration(async f => {
    const error = Error('own callback bridge stop rejected'); f.allowError(error);
    const owner = f.start(); f.registration.resolve(f.returned); await owner.registered;
    const closing = f.close(); await vi.waitFor(() => expect(f.count('callback:bridge.stop')).toBe(1));
    expect(f.count('callback:mcp.dispose')).toBe(0); f.stop.reject(error);
    const report = await closing; expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(report.cleanupFailed).toContain(`lifetime_resources:kswarm-and-bridges: ${error.message}`);
    expect(f.count('callback:mcp.dispose')).toBe(1); expect(f.count('own:final')).toBe(1);
    expect(f.index('own:ordinary.after-main')).toBeLessThan(f.index('callback:mcp.dispose'));
    expect(f.count('own:continuation')).toBe(1);
  }, { holdStop: true });
}, 15000);

it('A6 actual closing raw failure reaches real lifetime with identical memo reason and no invented disposer', async () => {
  await withActualMainRegistration(async f => {
    const error = Error('own callback closing registration rejected'); f.allowError(error);
    const owner = f.start(), fallback = f.finalRegistration(), closing = f.close();
    f.registration.reject(error); expect(await owner.registered).toBe(false);
    const report = await closing; expect(report.cleanupFailed).toContain('lifetime_resources');
    const same = owner.dispose(); expect(fallback.run()).toBe(same);
    expect(await Promise.allSettled([same])).toEqual([{ status: 'rejected', reason: error }]);
    expect(f.count('callback:mcp.dispose')).toBe(0); expect(f.count('callback:bridge.start')).toBe(0);
    expect(f.gate.outstanding).toBe(0); expect(f.count('own:final')).toBe(1); expect(f.count('own:continuation')).toBe(1);
  });
}, 15000);
