// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { ShutdownReport } from '../../electron/desktop-shutdown-coordinator.js';
import { withPythonFixture, readyResult, observed, turn } from './python-preparation-main-fixture.js';

it('P1 real Main reserves the actual gate/lifetime before invoking prepare and retains the same lifecycle Promise until its provided raw settles', async () => {
  await withPythonFixture('candidate', async f => {
    let prefix: { outstanding: number; steps: number } | undefined;
    f.hooks.prepare = () => { prefix = { outstanding: f.gate.outstanding, steps: f.steps.length }; };
    expect(await f.run()).toBe(f.windowData); expect(prefix).toEqual({ outstanding: 1, steps: 1 });
    expect(f.inputs).toEqual([f.deployment]);
    const retired = f.retirement()[0]; if (!retired) throw Error('actual_lifetime_registration_missing');
    expect(f.retirement()[0]).toBe(retired);
    // Reservation identity is preserved; it is deliberately NOT the prepare raw.
    expect(retired).not.toBe(f.preparations[0].promise); expect(f.gate.outstanding).toBe(1);
    f.preparations[0].resolve(readyResult()); expect((await observed(retired)).status).toBe('fulfilled');
    expect(f.gate.outstanding).toBe(0); expect(f.calls.register).toBe(1); expect(f.calls.provider).toBe(1);
    expect(f.receivers.every(receiver => receiver === f.services)).toBe(true);
    expect(f.managed()).toBe(readyResult().pythonCommand);
  });
}, 15000);

it('P2a a genuine prepare raw rejection after gate closure remains the identical lifecycle reason instead of a successful retirement', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); const error = new Error('own actual prepare raw rejected while closing');
    const retired = f.retirement()[0]; if (!retired) throw Error('actual_lifetime_registration_missing');
    const closing = f.close(); f.allowRetirementError(error); f.preparations[0].reject(error);
    const settled = await observed(retired); expect(settled.status).toBe('rejected');
    if (settled.status !== 'rejected') throw Error('prepare_raw_rejection_was_lost');
    expect(settled.reason).toBe(error); expect(f.retirement()[0]).toBe(retired);
    const report = await closing; expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0); expect(f.gate.outstanding).toBe(0);
  });
}, 15000);

it('P2 real Main owns the actual fallback registration raw and preserves its exact rejection reason on the lifecycle Promise', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); const prepareError = new Error('own prepare failure'), fallbackError = new Error('own fallback registration failure');
    const retired = f.retirement()[0]; if (!retired) throw Error('actual_lifetime_registration_missing');
    f.preparations[0].reject(prepareError);
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'createWindow:python-runtime-failed')).toBe(true));
    expect(f.gate.outstanding).toBe(1); expect(f.calls.provider).toBe(0);
    f.allowRetirementError(fallbackError); f.registration.reject(fallbackError);
    const settled = await observed(retired); expect(settled.status).toBe('rejected');
    if (settled.status !== 'rejected') throw Error('original_fallback_rejection_missing');
    expect(settled.reason).toBe(fallbackError); expect(f.retirement()[0]).toBe(retired); expect(f.gate.outstanding).toBe(0);
    const report = await f.close(); expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(f.calls.provider).toBe(0);
  }, 1, true);
}, 15000);

it('P3 gate closes while prepare is held: actual lifetime blocks close and no new register/provider starts after settlement', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); const closing = f.close(); let finished = false;
    void closing.then(() => { finished = true; }, () => { finished = true; });
    await turn(); expect(finished).toBe(false); expect(f.gate.outstanding).toBe(1);
    f.preparations[0].resolve(readyResult()); const report = await closing;
    expect(report.ordinaryDrained).toBe(true); expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
    expect(f.managed()).toBeUndefined(); expect(f.gate.outstanding).toBe(0);
  });
}, 15000);

it('P4 gate closes at the real registration await: no new deferred registration/provider is started', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); f.preparations[0].resolve(readyResult());
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'createWindow:python-runtime-ready')).toBe(true));
    const closing = f.close(); expect(f.gate.outstanding).toBe(1);
    f.registration.resolve(true); await closing;
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
  }, 1, true);
}, 15000);

it('P5 an already-started deferred registration remains in the real raw chain; closing then forbids a new provider', async () => {
  await withPythonFixture('candidate', async f => {
    let release!: () => void; const registrationRaw = new Promise<void>(resolve => { release = resolve; });
    f.hooks.register = () => registrationRaw;
    try {
      await f.run(); f.preparations[0].resolve(readyResult());
      await vi.waitFor(() => expect(f.calls.register).toBe(1));
      const closing = f.close(); let finished = false;
      void closing.then(() => { finished = true; }, () => { finished = true; });
      await turn(); expect(finished).toBe(false); expect(f.gate.outstanding).toBe(1);
      release(); await closing; expect(f.calls.provider).toBe(0); expect(f.gate.outstanding).toBe(0);
    } finally { release(); }
  });
}, 15000);

it('P6 repeated actual Main segment calls register two independent retirements; repeated close waits both and memoizes the coordinator result', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); await f.run(); expect(f.calls.prepare).toBe(2); expect(f.steps).toHaveLength(2);
    expect(f.gate.outstanding).toBe(2); const retirements = f.retirement(); expect(retirements[0]).not.toBe(retirements[1]);
    const closing = f.close(); expect(f.close()).toBe(closing); let finished = false;
    void closing.then(() => { finished = true; }, () => { finished = true; });
    f.preparations[0].resolve(readyResult()); await observed(retirements[0]);
    expect(f.gate.outstanding).toBe(1); expect(finished).toBe(false);
    f.preparations[1].resolve(readyResult()); const report = await closing;
    expect(report.ordinaryDrained).toBe(true); expect(f.gate.outstanding).toBe(0); expect(f.calls.continuation).toBe(1);
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
  }, 2);
}, 15000);

it('P7 synchronous producer-prefix close sees the already-registered actual token/reservation and cannot complete before that raw', async () => {
  await withPythonFixture('candidate', async f => {
    let snapshot: { outstanding: number; steps: number } | undefined, closing: Promise<ShutdownReport> | undefined;
    f.hooks.prepare = () => { snapshot = { outstanding: f.gate.outstanding, steps: f.steps.length }; closing = f.close(); };
    await f.run(); expect(snapshot).toEqual({ outstanding: 1, steps: 1 });
    if (!closing) throw Error('actual_reentrant_close_missing'); expect(f.close()).toBe(closing);
    expect(f.gate.outstanding).toBe(1); f.preparations[0].resolve(readyResult()); await closing;
    expect(f.gate.outstanding).toBe(0); expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
  });
}, 15000);

it('P8 actual original default 5000ms cap expiring does not make a held Python raw quiescent or close stores', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); const closing = f.close(); let finished = false;
    void closing.then(() => { finished = true; }, () => { finished = true; });
    // Real wall clock, no fake timers or replacement timeout values. This probe
    // uses the same real gate and is scheduled after the coordinator's default.
    const cap = f.gate.drain(5000); expect(await cap).toBe(false);
    expect(f.gate.outstanding).toBe(1); expect(finished).toBe(false); expect(f.calls.storeClose).toBe(0); expect(f.calls.pinRelease).toBe(0);
    expect(f.logs.some(value => value.event === 'shutdown_ordinary_cleanup_timeout')).toBe(true);
    f.preparations[0].resolve(readyResult()); const report = await closing;
    expect(report.ordinaryDrained).toBe(false); expect(report.storesClosed).toBe(false);
    expect(report.deferredReason).toBe('store_close_deferred_to_process_exit');
    expect(f.gate.outstanding).toBe(0); expect(f.calls.continuation).toBe(1);
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
  });
}, 20000);

it('P9 a previously closed real gate refuses this Main Python segment before any producer/lifetime allocation', async () => {
  await withPythonFixture('candidate', async f => {
    f.gate.close(); expect(await f.run()).toBe(f.windowData);
    expect(f.calls.prepare).toBe(0); expect(f.gate.outstanding).toBe(0); expect(f.steps).toHaveLength(0);
  });
}, 15000);

it('R306 prepare rejected while open, then close during the real fallback registration await: retain that original prepare reason', async () => {
  await withPythonFixture('candidate', async f => {
    await f.run(); const error = new Error('own prepare failed before fallback-await close');
    const retired = f.retirement()[0]; if (!retired) throw Error('actual_lifetime_registration_missing');
    f.preparations[0].reject(error);
    // Logger is a plain synchronous recorder. Once another turn sees this log,
    // the same catch job has passed its first open-gate check and is awaiting
    // the deliberately still-pending actual provided registration Promise.
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'createWindow:python-runtime-failed')).toBe(true));
    expect(f.gate.isOpen).toBe(true); expect(f.gate.outstanding).toBe(1);
    expect(f.calls.unavailable).toBe(0); expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
    let settled = false; void retired.then(() => { settled = true; }, () => { settled = true; });
    await turn(); expect(settled).toBe(false);
    const closing = f.close(); expect(f.gate.isOpen).toBe(false); expect(f.close()).toBe(closing);
    f.allowRetirementError(error); f.registration.resolve(true);
    const rejected = await observed(retired); expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') throw Error('prepare_reason_lost_at_second_closed_gate_check');
    expect(rejected.reason).toBe(error); expect(f.retirement()[0]).toBe(retired);
    const report = await closing; expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(f.gate.outstanding).toBe(0); expect(f.calls.unavailable).toBe(0);
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
  }, 1, true);
}, 15000);
