import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KIMI_CODING_PROFILES } from '../../../src/ai/providers/kimi-models.js';
import { runPackagedKimiSmoke } from '../../electron/kimi-packaged-smoke.js';

describe('packaged Kimi Desktop smoke', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('covers every KIMI_CODING_PROFILES model, task-local multi-turn replay, auth deny, and rollback deny', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-kimi-packaged-smoke-'));
    roots.push(root);
    const resultPath = join(root, 'result.json');

    await runPackagedKimiSmoke(resultPath);

    const expectedModels = Object.keys(KIMI_CODING_PROFILES);
    const serialized = readFileSync(resultPath, 'utf8');
    expect(serialized).not.toContain('PACKAGED_SMOKE_RUNTIME_ONLY');
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: 1,
      status: 'pass',
      modelResults: expectedModels.map((model) => ({
        model,
        requests: 2,
        secondTurnReplayedReasoning: true,
      })),
      authorizationDenyNetworkRequests: 0,
      rollbackDenyNetworkRequests: 0,
    });
  });
});
