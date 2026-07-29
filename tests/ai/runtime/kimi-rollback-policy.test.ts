import { describe, expect, it } from 'vitest';
import { assertKimiTransportAllowed } from '../../../src/ai/runtime/kimi-rollback-policy.js';
import { XIAOK_BUILD_ID } from '../../../src/build-flavor.js';

describe('immutable Kimi rollback transport policy', () => {
  it('labels release artifacts with the frozen D8 rollout identity', () => {
    expect(XIAOK_BUILD_ID).toBe('xiaok-normal-kimi-k3-d8');
  });

  it.each([
    'https://api.kimi.com',
    'https://api.kimi.com:443/coding/v1',
    'https://api.kimi.com:/coding/v1',
    'https://api.kimi.com.../coding/v1',
    'https://api.kimi.com.:443/coding/v1',
    'https://user:password@api.kimi.com/coding/v1',
    'https://ａｐｉ．ｋｉｍｉ．ｃｏｍ/coding/v1',
    'https://api.kimi.com//coding/../coding/v1?x=1#fragment',
    'https://API.KIMI.COM/coding/v1/chat/completions',
  ])('denies official K3 transport independent of URL path shape: %s', (url) => {
    expect(() => assertKimiTransportAllowed({
      canonicalBaseUrl: url,
      wireModel: 'k3',
    }, 'rollback')).toThrow('KIMI_K3_DISABLED_IN_ROLLBACK_BUILD');
  });

  it('denies k3-256k but leaves non-K3 and non-official bindings available', () => {
    expect(() => assertKimiTransportAllowed({
      canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
      wireModel: 'k3-256k',
    }, 'rollback')).toThrow('KIMI_K3_DISABLED_IN_ROLLBACK_BUILD');
    expect(() => assertKimiTransportAllowed({
      canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
      wireModel: 'kimi-k2.5',
    }, 'rollback')).not.toThrow();
    expect(() => assertKimiTransportAllowed({
      canonicalBaseUrl: 'https://example.com/coding/v1',
      wireModel: 'k3',
    }, 'rollback')).not.toThrow();
  });

  it('keeps non-default ports, suffix hosts, non-HTTPS URLs, and IDNA lookalikes outside the official host', () => {
    for (const url of [
      'https://api.kimi.com:444/coding/v1',
      'https://api.kimi.com.example.org/coding/v1',
      'http://api.kimi.com/coding/v1',
      'https://арі.kimi.com/coding/v1',
    ]) {
      expect(() => assertKimiTransportAllowed({
        canonicalBaseUrl: url,
        wireModel: 'k3',
      }, 'rollback')).not.toThrow();
    }
  });
});
