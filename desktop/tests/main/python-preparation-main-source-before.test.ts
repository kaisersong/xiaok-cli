// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { withPythonFixture, readyResult } from './python-preparation-main-fixture.js';

it('SOURCE BEFORE actual Main: an unresolved prepare raw is absent from its real gate/lifetime, and app shutdown can complete first', async () => {
  await withPythonFixture('before', async f => {
    expect(await f.run()).toBe(f.windowData);
    expect(f.calls.prepare).toBe(1); expect(f.gate.outstanding).toBe(0); expect(f.steps).toHaveLength(0);
    expect(f.retirement()).toHaveLength(0);
    const report = await f.close();
    expect(report.ordinaryDrained).toBe(true); expect(f.calls.continuation).toBe(1);
    expect(f.calls.register).toBe(0); expect(f.calls.provider).toBe(0);
    // Owned callback-only countercontrol, NOT a Python/app/SDK invocation.
    f.preparations[0].resolve(readyResult());
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'provider-runtime:start')).toBe(true));
    expect(f.calls.register).toBe(1); expect(f.calls.provider).toBe(1);
  });
}, 15000);

it('SOURCE BEFORE actual Main fallback: failed prepare leaves an unreturned held registration tail outside real lifecycle ownership', async () => {
  await withPythonFixture('before', async f => {
    await f.run(); const error = new Error('own preparation failed before fallback');
    f.preparations[0].reject(error);
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'createWindow:python-runtime-failed')).toBe(true));
    expect(f.gate.outstanding).toBe(0); expect(f.steps).toHaveLength(0);
    const report = await f.close(); expect(report.ordinaryDrained).toBe(true);
    expect(f.calls.provider).toBe(0);
    f.registration.resolve(true);
    await vi.waitFor(() => expect(f.logs.some(value => value.event === 'provider-runtime:start-after-python-failure')).toBe(true));
    expect(f.calls.provider).toBe(1);
  }, 1, true);
}, 15000);
