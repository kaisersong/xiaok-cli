import { describe, expect, it } from 'vitest';
import * as shared from '../../shared/model-text-repetition-code';
import * as runtime from '../../../src/ai/runtime/model-text-repetition';

// Renderer must not import src/ at runtime (governance cross-layer-private-import),
// so desktop/shared mirrors the runtime classifier. Keep both in lockstep.
const cyclic: { message: string; cause?: unknown } = { message: 'outer' };
cyclic.cause = cyclic;
const inputs: unknown[] = [
  'MODEL_TEXT_REPETITION_DETECTED',
  'Error: MODEL_TEXT_REPETITION_DETECTED',
  'Error: model_failed: MODEL_TEXT_REPETITION_DETECTED (after 657 chars)',
  'MODEL_TEXT_REPETITION_DETECTED_EXTRA',
  'the model said MODEL_TEXT_REPETITION_DETECTED in prose',
  '我看到 MODEL_TEXT_REPETITION_DETECTED',
  '',
  null,
  undefined,
  42,
  { code: 'MODEL_TEXT_REPETITION_DETECTED', message: 'masked' },
  { code: 'model_failed', message: 'x', cause: { code: 'MODEL_TEXT_REPETITION_DETECTED' } },
  { message: 'wrapper', cause: new Error('MODEL_TEXT_REPETITION_DETECTED') },
  { message: 'wrapper', cause: 'MODEL_TEXT_REPETITION_DETECTED' },
  { message: 'wrapper', cause: 'mentions MODEL_TEXT_REPETITION_DETECTED later' },
  new Error('provider 500'),
  cyclic,
];

describe('renderer-safe repetition classifier parity', () => {
  it('shares the runtime code constant', () => {
    expect(shared.MODEL_TEXT_REPETITION_CODE).toBe(runtime.MODEL_TEXT_REPETITION_CODE);
  });
  it.each(inputs.map((input, i) => [i, input]))('error #%i classifies identically', (_i, input) => {
    expect(shared.isModelTextRepetitionError(input)).toBe(runtime.isModelTextRepetitionError(input));
  });
  it.each(inputs.filter((v): v is string => typeof v === 'string').map(v => [v]))('message %j classifies identically', (text) => {
    expect(shared.isModelTextRepetitionMessage(text)).toBe(runtime.isModelTextRepetitionMessage(text));
  });
  it('keeps source text of both implementations in sync', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const body = (file: string, name: string) => {
      const src = readFileSync(resolve(__dirname, file), 'utf8');
      const start = src.indexOf(`export function ${name}`);
      const end = src.indexOf('\n}\n', start);
      return src.slice(start, end);
    };
    for (const name of ['isModelTextRepetitionMessage', 'isModelTextRepetitionError']) {
      expect(body('../../shared/model-text-repetition-code.ts', name)).toBe(body('../../../src/ai/runtime/model-text-repetition.ts', name));
    }
  });
});
