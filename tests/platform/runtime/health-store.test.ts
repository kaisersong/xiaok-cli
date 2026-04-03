import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileCapabilityHealthStore } from '../../../src/platform/runtime/health-store.js';

describe('capability health store', () => {
  it('persists health snapshots by cwd across store instances', () => {
    const root = join(tmpdir(), `xiaok-health-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'health.json');

    try {
      const store = new FileCapabilityHealthStore(filePath);
      store.set('/repo', {
        updatedAt: 1,
        summary: 'mcp:docs connected (2 tools)',
        capabilities: [
          { kind: 'mcp', name: 'docs', status: 'connected', detail: '2 tools' },
        ],
      });

      const reloaded = new FileCapabilityHealthStore(filePath);
      expect(reloaded.get('/repo')).toMatchObject({
        summary: 'mcp:docs connected (2 tools)',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
