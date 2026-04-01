import { describe, expect, it } from 'vitest';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('CapabilityRegistry', () => {
  it('returns the same capability for discovery and executable lookup', () => {
    const registry = new CapabilityRegistry();
    registry.register({
      kind: 'skill',
      name: 'cognitive-coach',
      description: 'think deeper',
      execute: async () => 'ok',
    });

    expect(registry.search('cognitive').map((entry) => entry.name)).toEqual(['cognitive-coach']);
    expect(registry.get('cognitive-coach')).toMatchObject({ kind: 'skill' });
  });
});
