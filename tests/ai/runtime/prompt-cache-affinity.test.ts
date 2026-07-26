import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type CreatePromptCacheAffinity = (sessionId: string) => string | undefined;

let createPromptCacheAffinity: CreatePromptCacheAffinity | undefined;

beforeAll(async () => {
  const modulePath = '../../../src/ai/runtime/' + 'prompt-cache-affinity.js';
  const module = await import(modulePath).catch(() => undefined) as
    | { createPromptCacheAffinity?: CreatePromptCacheAffinity }
    | undefined;
  createPromptCacheAffinity = module?.createPromptCacheAffinity;
});

describe('createPromptCacheAffinity', () => {
  it('derives the frozen domain-separated affinity for RFC 4122 UUID sessions', () => {
    expect(createPromptCacheAffinity).toBeTypeOf('function');
    if (!createPromptCacheAffinity) return;

    const sessionId = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
    const expected = `pc1_${createHash('sha256')
      .update(`xiaok:kimi-prompt-cache:v1\0${sessionId}`)
      .digest('hex')}`;

    expect(createPromptCacheAffinity(sessionId)).toBe(expected);
    expect(createPromptCacheAffinity('sess_123e4567-e89b-12d3-a456-426614174000'))
      .toMatch(/^pc1_[0-9a-f]{64}$/);
  });

  it('returns stable keys for one session and distinct keys for a fork', () => {
    expect(createPromptCacheAffinity).toBeTypeOf('function');
    if (!createPromptCacheAffinity) return;

    const source = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
    const fork = 'sess_00000000-0000-4000-8000-000000000000';

    expect(createPromptCacheAffinity(source)).toBe(createPromptCacheAffinity(source));
    expect(createPromptCacheAffinity(fork)).not.toBe(createPromptCacheAffinity(source));
  });

  it.each([
    'sess_1',
    'transient',
    'sess_lz1234_ab12cd',
    'sess_123e4567-e89b-02d3-a456-426614174000',
    'sess_123e4567-e89b-42d3-7456-426614174000',
    'sess_123e4567-e89b-42d3-a456-42661417400',
    '123e4567-e89b-42d3-a456-426614174000',
  ])('rejects non-RFC 4122 or legacy session ID %s', (sessionId) => {
    expect(createPromptCacheAffinity).toBeTypeOf('function');
    if (!createPromptCacheAffinity) return;

    expect(createPromptCacheAffinity(sessionId)).toBeUndefined();
  });

  it('does not expose the raw session ID, cwd, or model name', () => {
    expect(createPromptCacheAffinity).toBeTypeOf('function');
    if (!createPromptCacheAffinity) return;

    const sessionId = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
    const affinity = createPromptCacheAffinity(sessionId);

    expect(affinity).not.toContain(sessionId);
    expect(affinity).not.toContain('/workspace/private');
    expect(affinity).not.toContain('k3');
  });
});

describe('canonical StreamOptions contract', () => {
  it('makes model-capabilities the only ModelAdapter stream options source', () => {
    const source = readFileSync(join(process.cwd(), 'src/types.ts'), 'utf8');

    expect(source).toMatch(
      /import type \{[^}]*StreamOptions[^}]*\} from '\.\/ai\/runtime\/model-capabilities\.js';/s,
    );
    expect(source).toMatch(/options\?: StreamOptions,/);
    expect(source).not.toMatch(/options\?:\s*\{\s*promptCache\?:/s);
  });
});
