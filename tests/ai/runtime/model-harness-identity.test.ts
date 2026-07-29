import { describe, expect, it } from 'vitest';
import {
  assertKimiK3SessionModelSwitchSupported,
} from '../../../src/ai/runtime/model-harness-identity.js';

describe('Kimi K3 session model switch boundary', () => {
  it('blocks history-bearing switches across strict and generic profiles', () => {
    expect(() => assertKimiK3SessionModelSwitchSupported(
      'kimi-k3-coding-openai',
      undefined,
      1,
    )).toThrow('KIMI_K3_SESSION_MODEL_SWITCH_UNSUPPORTED');
    expect(() => assertKimiK3SessionModelSwitchSupported(
      undefined,
      'kimi-k3-256k-coding-openai',
      1,
    )).toThrow('KIMI_K3_SESSION_MODEL_SWITCH_UNSUPPORTED');
  });

  it('allows empty sessions and same-profile switches', () => {
    expect(() => assertKimiK3SessionModelSwitchSupported(
      'kimi-k3-coding-openai',
      undefined,
      0,
    )).not.toThrow();
    expect(() => assertKimiK3SessionModelSwitchSupported(
      'kimi-k3-coding-openai',
      'kimi-k3-coding-openai',
      2,
    )).not.toThrow();
  });
});
