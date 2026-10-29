// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateHarnessConfigPatch } from '../../electron/harness-optimization-config.js';

describe('validateHarnessConfigPatch whitelist', () => {
  it('accepts whitelisted keys within bounds', () => {
    expect(validateHarnessConfigPatch({ mode: 'probe', maxExtraRequestsPerUtcDay: 5 }))
      .toEqual({ mode: 'probe', maxExtraRequestsPerUtcDay: 5 });
  });
  it.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'])(
    'rejects inherited Object.prototype key %s', key => {
      const patch = JSON.parse(`{${JSON.stringify(key)}:5}`) as Record<string, unknown>;
      expect(Object.keys(patch)).toEqual([key]);
      expect(() => validateHarnessConfigPatch(patch)).toThrow('invalid_config');
    });
  it('rejects unknown and lifecycle keys', () => {
    for (const key of ['enabled', 'publicGeneration', 'researchGeneration', 'configRevision', 'unknownKey'])
      expect(() => validateHarnessConfigPatch({ [key]: 5 })).toThrow('invalid_config');
  });
});
