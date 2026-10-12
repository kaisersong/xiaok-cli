// @vitest-environment node
// Real TS/CJS preload and renderer getDesktopApi -> real Main registrar/service. No fake page.
import { readFileSync } from 'node:fs';
import { it, expect, vi, afterEach } from 'vitest';
import { fixture, TARGET, METHODS, deferred } from '../support/diagnostics-input-fixture.js';
import { getDesktopApi, _resetDesktopApiCache } from '../../renderer/src/shared/desktop.js';
afterEach(() => _resetDesktopApiCache());
function expose(api: unknown) { _resetDesktopApiCache(); vi.stubGlobal('window', { xiaokDesktop: api }); const consumer = getDesktopApi(); expect(consumer).not.toBeNull(); return consumer!; }
it('CONSUMER_SUCCESS actual renderer adapter retains TS+CJS method mapping and committed export/evidence facts', async () => {
  const f = await fixture();
  for (const raw of [f.preload, f.cjs]) {
    const consumer = expose(raw), result = await consumer.exportTraceBundle(TARGET); expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(result.path!, 'utf8')).scope).toMatchObject({ kind: 'project', projectId: 'project-1' });
    const report = await consumer.diagnose(TARGET); expect(report.primaryFinding?.category).toBe('blocked_task'); expect(report.evidence.length).toBeGreaterThan(0);
  }
});
it('CONSUMER_FALSE_REJECT actual adapter preserves export business false and diagnosis rejection without success fallback', async () => {
  const f = await fixture(500), error = 'kswarm project detail request failed: HTTP 500';
  for (const raw of [f.preload, f.cjs]) {
    const consumer = expose(raw); expect(await consumer.exportTraceBundle(TARGET)).toEqual({ ok: false, error }); await expect(consumer.diagnose(TARGET)).rejects.toThrow(error);
  }
  expect(f.requests).toHaveLength(4);
});
it.each(METHODS)('CONSUMER_INPUT %s sends exactly the original single payload; invalid target is rejected before producer', async method => {
  const f = await fixture(), producer = vi.spyOn(f.service, method);
  for (const raw of [f.preload, f.cjs]) {
    const consumer = expose(raw); await expect(Reflect.apply(consumer[method], consumer, [{ kind: 'future-kind', id: 'missing' }])).rejects.toThrow('diagnostics_input_invalid');
  }
  expect(producer).not.toHaveBeenCalled(); expect(f.requests).toEqual([]);
});
it('CONSUMER_OVERLAP held independent real reads settle to their original callers without coalescing/retry or shared DTOs', async () => {
  const f = await fixture(), first = deferred<Response>(), second = deferred<Response>(), consumer = expose(f.preload);
  f.setResponse(path => path.includes('/first/') ? first.promise : second.promise);
  const a = consumer.diagnose({ kind: 'project', id: 'first' }), b = consumer.diagnose({ kind: 'project', id: 'second' }); await Promise.resolve(); expect(f.gate.outstanding).toBe(2);
  try {
    second.resolve(Response.json({ ...f.detail, project: { ...f.detail.project, id: 'second' } })); const newer = await b; expect(newer.target).toEqual({ kind: 'project', id: 'second' }); expect(f.gate.outstanding).toBe(1);
    first.resolve(Response.json({ ...f.detail, project: { ...f.detail.project, id: 'first' } })); const older = await a; expect(older.target).toEqual({ kind: 'project', id: 'first' }); expect(older).not.toBe(newer); expect(older.evidence).not.toBe(newer.evidence);
  } finally { first.resolve(Response.json(f.detail)); second.resolve(Response.json(f.detail)); await Promise.allSettled([a, b]); }
  expect(f.requests).toHaveLength(2); expect(f.gate.outstanding).toBe(0);
});
it('CONSUMER_NAMESPACE held export remains owned work after adapter detaches; namespace/reset cannot resend or invent cancel', async () => {
  const f = await fixture(), held = deferred<Response>(), consumer = expose(f.cjs); f.setResponse(() => held.promise);
  const pending = consumer.exportTraceBundle(TARGET); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  vi.stubGlobal('window', undefined); _resetDesktopApiCache(); expect(getDesktopApi()).toBeNull();
  try { held.resolve(Response.json(f.detail)); const result = await pending; expect(result.ok).toBe(true); expect(JSON.parse(readFileSync(result.path!, 'utf8')).scope.kind).toBe('project'); }
  finally { held.resolve(Response.json(f.detail)); await pending; }
  expect(f.requests).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
  // There is no current trace/diagnose React page/controller to fabricate locale/unmount state for.
});
