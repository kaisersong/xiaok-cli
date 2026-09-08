import { describe, expect, it } from 'vitest';
import { requiresKimiK3HistoryMigration } from '../../../src/ai/runtime/model-harness-identity.js';
describe('K3 model switch migration', () => {
  it('migrates cross-profile history and preserves same-profile or empty histories', () => {
    expect(requiresKimiK3HistoryMigration('kimi-k3-coding-openai', undefined, 1)).toBe(true);
    expect(requiresKimiK3HistoryMigration(undefined, 'kimi-k3-256k-coding-openai', 1)).toBe(true);
    expect(requiresKimiK3HistoryMigration('kimi-k3-coding-openai', 'kimi-k3-256k-coding-openai', 1)).toBe(true);
    expect(requiresKimiK3HistoryMigration('kimi-k3-coding-openai', 'kimi-k3-coding-openai', 1)).toBe(false);
    expect(requiresKimiK3HistoryMigration('kimi-k3-coding-openai', undefined, 0)).toBe(false);
    expect(requiresKimiK3HistoryMigration(undefined, undefined, 1)).toBe(false);
  });
});
