import { describe, it, expect } from 'vitest';
import { KSwarmExecutionClock, resolveKSwarmWorkerRunMs } from '../../electron/kswarm-execution-clock.js';
describe('KSwarm actual execution clock', () => {
  it.each([undefined, null, {}, { required: true }, { version: 1, kind: 'other', required: true }])('keeps the legacy bound for incomplete or unrelated contracts %j', contract => {
    expect(resolveKSwarmWorkerRunMs({ evidenceContract: contract })).toBe(20 * 60 * 1000);
  });
  it('bounds canonical research at sixty minutes', () => {
    const clock = new KSwarmExecutionClock(resolveKSwarmWorkerRunMs({ evidenceContract: { version: 1, kind: 'external_source_v1', required: true } }));
    clock.start(0);
    expect(clock.expired(20 * 60 * 1000)).toBe(false);
    expect(clock.expired(60 * 60 * 1000)).toBe(true);
  });
  it('does not charge queue time and cannot restart an active deadline', () => {
    const clock = new KSwarmExecutionClock(100);
    expect(clock.expired(100000)).toBe(false);
    clock.start(100000);
    expect(clock.expired(100099)).toBe(false);
    clock.start(100099);
    expect(clock.expired(100100)).toBe(true);
  });
});
