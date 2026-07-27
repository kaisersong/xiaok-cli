import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_JSON_V1_ENCODER_ID,
  canonicalJsonV1,
} from '../../../src/ai/runtime/canonical-json.js';

describe('canonicalJsonV1', () => {
  it('emits integer-like keys by raw UTF-16 order with frozen golden bytes', () => {
    const input = {
      2: 'two',
      10: 'ten',
      4294967294: 'max-index',
      4294967295: 'not-index',
      '01': 'zero-one',
      a: 'a',
    };
    const expected = '{"01":"zero-one","10":"ten","2":"two","4294967294":"max-index","4294967295":"not-index","a":"a"}';

    expect(CANONICAL_JSON_V1_ENCODER_ID).toBe('xiaok-canonical-json-direct-v1');
    expect(canonicalJsonV1(input)).toBe(expected);
    expect(createHash('sha256').update(expected).digest('hex'))
      .toBe('84bf6fae7db067f0228828ab24d3d9f615e83fdd0db16e3e37775ae9a8803b8f');
  });

  it('emits nested integer-like keys without container JSON.stringify reordering', () => {
    const expected = '{"1":"one","x":{"10":"a","2":"b"}}';

    expect(canonicalJsonV1({ x: { 2: 'b', 10: 'a' }, 1: 'one' })).toBe(expected);
    expect(createHash('sha256').update(expected).digest('hex'))
      .toBe('91ccd02a5f04e5d1cd3fbe1f881972aa9183d705e6bd4e51680eef43bcf07a5f');
  });

  it.each([
    ['proxy', new Proxy({}, {})],
    ['array hole', Array(1)],
    ['non-finite', Number.NaN],
    ['undefined', undefined],
    ['custom prototype', Object.create({ inherited: true })],
  ])('rejects invalid grammar: %s', (_label, value) => {
    expect(() => canonicalJsonV1(value)).toThrow('canonicalJsonV1InvalidGrammar');
  });

  it('rejects depth 129 with a stable limit error', () => {
    let value: unknown = null;
    for (let index = 0; index < 129; index += 1) {
      value = [value];
    }

    expect(() => canonicalJsonV1(value)).toThrow('canonicalJsonV1LimitExceeded');
  });

  it('uses only eagerly captured intrinsics after module initialization', () => {
    const originalNumberIsInteger = Number.isInteger;
    const originalObjectIs = Object.is;
    const originalString = globalThis.String;
    const originalMathMax = Math.max;
    try {
      Object.defineProperty(Number, 'isInteger', {
        configurable: true,
        value: () => false,
      });
      Object.defineProperty(Object, 'is', {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(globalThis, 'String', {
        configurable: true,
        value: () => 'tampered',
      });
      Object.defineProperty(Math, 'max', {
        configurable: true,
        value: () => 999,
      });

      expect(canonicalJsonV1({ array: [0, 1], object: { 2: -0 } }))
        .toBe('{"array":[0,1],"object":{"2":0}}');
    } finally {
      Object.defineProperty(Number, 'isInteger', {
        configurable: true,
        value: originalNumberIsInteger,
      });
      Object.defineProperty(Object, 'is', {
        configurable: true,
        value: originalObjectIs,
      });
      Object.defineProperty(globalThis, 'String', {
        configurable: true,
        value: originalString,
      });
      Object.defineProperty(Math, 'max', {
        configurable: true,
        value: originalMathMax,
      });
    }
  });
});
