import { describe, it, expect } from 'vitest';
import { KSwarmExecutionClock } from '../../electron/kswarm-execution-clock.js';
describe('KSwarm actual execution clock', () => {
  it('does not charge queue time and cannot restart an active deadline', () => {
    const clock = new KSwarmExecutionClock(100);
    expect(clock.expired(100000)).toBe(false);
    clock.start(100000);
    expect(clock.expired(100099)).toBe(false);
    clock.start(100099);
    expect(clock.expired(100100)).toBe(true);
  });
});
