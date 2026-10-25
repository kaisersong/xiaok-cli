// Source-before controls; successful queue/SDK/physical planning are not qualified here.
// @vitest-environment node
import { expect, it } from 'vitest';
import { fixture } from '../support/diagnostics-input-fixture.js';
import { IPC_SCHEMA_REGISTRY } from '../../electron/ipc-runtime.js';
const channel = 'desktop:kswarm:startProjectPlanning';
it('planning owns an exact one-argument tuple before project-id logging', async () => {
  await fixture();
  expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({ payloadMode: 'tuple', inputStage: 'beforeHandler', sourceFile: 'desktop/electron/project-planning-typed-ipc.ts' });
});
it('planning payload accessor cannot run before admission and enqueue', async () => {
  const f = await fixture(); let reads = 0, effects = 0;
  f.service.startProjectPlanning = (() => { effects++; return { ok: true, status: 'queued' }; }) as typeof f.service.startProjectPlanning;
  const input = Object.defineProperty({}, 'projectId', { enumerable: true, get() { reads++; throw Error('planning-owned-getter'); } });
  const pending = Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender: f.sender, senderFrame: f.frame }, input]);
  const error = await Promise.resolve(pending).then(() => null, error => error);
  expect(reads).toBe(0); expect(effects).toBe(0); expect(error.message).toBe('project_planning_input_invalid'); expect(f.gate.outstanding).toBe(0);
});
it.each([undefined, 'agent', 'scheduler', 'unknown'])('public planning service denies %s before reading the payload', async source => {
  const f = await fixture(); let reads = 0;
  const input = Object.defineProperty({}, 'projectId', { enumerable: true, get() { reads++; throw Error('planning-owned-service-getter'); } });
  let error: unknown;
  try { Reflect.apply(f.service.startProjectPlanning, f.service, [input, source]); } catch (failure) { error = failure; }
  expect(reads).toBe(0); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('project_planning_source_forbidden');
});
