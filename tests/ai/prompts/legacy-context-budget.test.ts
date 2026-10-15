import { describe, expect, it } from 'vitest';
import {
  promptAutoContextBudget,
  resolveAutoContextMaxChars,
  truncateContextContent,
} from '../../../src/ai/runtime/context-budget.js';

describe('legacy prompt document budget', () => {
  it('lets the real loader default retain document text when prompt budget is absent', () => {
    const options = promptAutoContextBudget(() => undefined);
    expect(Object.hasOwn(options, 'maxChars')).toBe(false);
    const maxChars = resolveAutoContextMaxChars(options.maxChars);
    expect(maxChars).toBe(8_000);
    expect(truncateContextContent('workspace guidance', maxChars)).toEqual({
      content: 'workspace guidance', truncated: false,
    });
    const longDocument = truncateContextContent('x'.repeat(9_000), maxChars);
    expect(longDocument.truncated).toBe(true);
    expect(longDocument.content).toHaveLength(8_000);
    expect(longDocument.content.startsWith('x')).toBe(true);
    expect(longDocument.content.endsWith('\n...(已截断)')).toBe(true);
  });

  it.each([
    { label: 'positive', budget: 1_500, maxChars: 3_000 },
    { label: 'small positive', budget: 1, maxChars: 1_200 },
    { label: 'zero', budget: 0, maxChars: 1_200 },
    { label: 'negative', budget: -1, maxChars: 1_200 },
    { label: 'positive infinity', budget: Infinity, maxChars: Infinity },
    { label: 'negative infinity', budget: -Infinity, maxChars: 1_200 },
  ])('preserves explicit $label policy without the loader default', ({ budget, maxChars }) => {
    const options = promptAutoContextBudget(() => budget);
    expect(Object.hasOwn(options, 'maxChars')).toBe(true);
    expect(options.maxChars).toBe(maxChars);
    expect(resolveAutoContextMaxChars(options.maxChars)).toBe(maxChars);
  });

  it.each([0, -1, Infinity, -Infinity])('keeps a direct loader character limit of %s explicit', (maxChars) => {
    expect(resolveAutoContextMaxChars(maxChars)).toBe(maxChars);
  });

  it('keeps explicit NaN distinct from absence, including its existing truncation result', () => {
    const options = promptAutoContextBudget(() => NaN);
    expect(Object.hasOwn(options, 'maxChars')).toBe(true);
    expect(options.maxChars).toBeNaN();
    const maxChars = resolveAutoContextMaxChars(options.maxChars);
    expect(maxChars).toBeNaN();
    expect(truncateContextContent('workspace guidance', maxChars)).toEqual({
      content: '\n...(已截断)', truncated: true,
    });
  });

});
