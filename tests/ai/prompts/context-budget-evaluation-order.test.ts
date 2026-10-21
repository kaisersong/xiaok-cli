import { expect, it } from 'vitest';
import { promptAutoContextBudget } from '../../../src/ai/runtime/context-budget.js';

it('uses the Math.max member and receiver captured before an explicit budget getter', () => {
  const originalMax = Math.max;
  let receiver: typeof Math | undefined;
  let result: { maxChars?: number } | undefined;
  try {
    Math.max = function (this: typeof Math, ...values: number[]): number {
      receiver = this;
      return originalMax(...values);
    };
    const input = {
      get budget() {
        Math.max = () => -55;
        return 1_500;
      },
    };
    result = promptAutoContextBudget(() => input.budget);
  } finally {
    Math.max = originalMax;
  }
  expect(result?.maxChars).toBe(3_000);
  expect(receiver).toBe(Math);
});
