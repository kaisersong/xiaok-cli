import { describe, expect, it } from 'vitest';
import { probeProcessIdentity, selfProcessIdentity } from '../../../src/platform/provider-store/process-identity.js';

describe('process identity probe (real OS)', () => {
  it('reports our own process as alive with a non-empty start identity', () => {
    const self = selfProcessIdentity();
    expect(self.pid).toBe(process.pid);
    expect(self.startIdentity.length).toBeGreaterThan(0);
    const probe = probeProcessIdentity(process.pid);
    expect(probe.kind).toBe('alive');
  });

  it('reports an impossible pid as dead, not unknown', () => {
    expect(probeProcessIdentity(999_999).kind).toBe('dead');
  });

  it('rejects an invalid pid as unknown rather than dead', () => {
    expect(probeProcessIdentity(-1).kind).toBe('unknown');
  });
});
