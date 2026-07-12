import { describe, expect, it } from 'vitest';
import {
  calculateCharacterErrorRate,
  normalizeTextForCer,
  resolveAsrSpikeHarnessReadiness,
} from '../../electron/asr-spike-protocol.js';

describe('ASR spike protocol', () => {
  it('normalizes punctuation, width, case, and whitespace for CER without hiding traditional Chinese output', () => {
    expect(normalizeTextForCer('會議  AＢＣ，明天 10 点。')).toBe('會議abc明天10点');
    expect(normalizeTextForCer('会议 ABC 明天 10 点')).toBe('会议abc明天10点');
  });

  it('counts traditional Chinese output as product-visible CER errors', () => {
    const cer = calculateCharacterErrorRate({
      hypothesis: '會議記錄',
      reference: '会议记录',
    });

    expect(cer).toBe(1);
  });

  it('keeps Arabic and Chinese numerals distinct for business-critical amounts and dates', () => {
    const cer = calculateCharacterErrorRate({
      hypothesis: '预算30000下周三',
      reference: '预算三万下周三',
    });

    expect(cer).toBeGreaterThan(0);
  });

  it('skips local quality harnesses when private fixtures are not configured', () => {
    expect(resolveAsrSpikeHarnessReadiness({ env: {} })).toEqual({
      ready: false,
      skip: true,
      reason: 'ASR_FIXTURE_DIR not set',
    });
  });

  it('allows local quality harnesses only when the private fixture directory is configured', () => {
    expect(resolveAsrSpikeHarnessReadiness({ env: { ASR_FIXTURE_DIR: '/private/asr-fixtures' } })).toEqual({
      ready: true,
      skip: false,
      fixtureDir: '/private/asr-fixtures',
    });
  });
});
