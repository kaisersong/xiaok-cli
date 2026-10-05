import { createTestOnlyCapacityProfile } from '../../src/runtime/sol-pi/capacity-admission.js';

/** Synthetic HTTP fixture budget only, never evidence for a live model/tokenizer. */
export function testOnlyCapacity(destination: string, model: string) {
  return createTestOnlyCapacityProfile({ destination, model, windowTokens: 10_000_000,
    outputLimitField: 'max_tokens', defaultOutputTokens: 8192, safetyMarginTokens: 1024,
    countSerializedInput: serialized => Buffer.byteLength(serialized, 'utf8') });
}
