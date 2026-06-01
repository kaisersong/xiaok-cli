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

  it('round-trips deferred status without coercion or loss', () => {
    const root = join(tmpdir(), `xiaok-health-store-deferred-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'health.json');

    try {
      const store = new FileCapabilityHealthStore(filePath);
      store.set('/repo', {
        updatedAt: 2,
        summary: 'mcp:cua-driver deferred (lazy CUA)',
        capabilities: [
          { kind: 'mcp', name: 'cua-driver', status: 'deferred', detail: 'lazy CUA' },
        ],
      });

      const reloaded = new FileCapabilityHealthStore(filePath);
      const snap = reloaded.get('/repo');
      expect(snap?.capabilities).toEqual([
        { kind: 'mcp', name: 'cua-driver', status: 'deferred', detail: 'lazy CUA' },
      ]);
      expect(snap?.summary).toBe('mcp:cua-driver deferred (lazy CUA)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
