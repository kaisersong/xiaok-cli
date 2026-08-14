import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('sandbox preload bundle', () => {
  it('uses a self-contained CommonJS preload file for sandboxed Electron renderers', async () => {
    const preload = await readFile(join(repoRoot, 'desktop', 'electron', 'preload.cjs'), 'utf8');
    const main = await readFile(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    expect(main).toContain('preload.cjs');
    expect(preload).toContain("require('electron')");
    expect(preload).toContain("contextBridge.exposeInMainWorld('xiaokDesktop'");
    expect(preload).not.toMatch(/\bimport\s+/);
    expect(preload).not.toMatch(/require\(['"]\.\//);
  });

  it('exposes only semantic artifact workspace methods and strips renderer-owned authority fields', async () => {
    const preload = await readFile(join(repoRoot, 'desktop', 'electron', 'preload.cjs'), 'utf8');

    const keys = [
      'getArtifactWorkspaceSnapshot',
      'readArtifactWorkspaceVersionPreview',
      'exportArtifactWorkspaceVersion',
      'createArtifactPlaceholder',
      'submitArtifactGeneration',
      'cancelArtifactGeneration',
      'retryArtifactGeneration',
      'preferArtifactVersion',
      'removeArtifactWorkspaceNode',
      'updateArtifactWorkspaceLayout',
      'saveArtifactWorkspaceViewport',
      'createArtifactWorkspaceCollection',
      'createArtifactWorkspaceNote',
      'updateArtifactWorkspaceNote',
      'createArtifactWorkspaceRelation',
      'setArtifactCollectionMembership',
      'recordArtifactWorkspaceEvent',
    ];
    for (const key of keys) {
      expect(preload).toContain(`${key}:`);
      expect(preload).toContain(`desktop:artifactWorkspace:${key}`);
    }
    expect(preload).toContain('sanitizeArtifactWorkspaceInput');
    expect(preload).not.toContain('reconcileArtifactWorkspace:');
    expect(preload).not.toContain('gcArtifactWorkspace:');
    expect(preload).not.toContain('renewArtifactWorkspaceLease:');
    expect(preload).not.toContain('executeCanvasCommand:');
  });

  it('exposes fixed assistant and KSwarm mutation channels without token or arbitrary HTTP arguments', async () => {
    const preload = await readFile(join(repoRoot, 'desktop', 'electron', 'preload.cjs'), 'utf8');

    for (const channel of [
      'desktop:assistant:getOverview',
      'desktop:assistant:activate',
      'desktop:assistant:pause',
      'desktop:assistant:resume',
      'desktop:assistant:acceptCandidate',
      'desktop:assistant:rejectCandidate',
      'desktop:kswarm:team:plan',
      'desktop:kswarm:team:apply',
      'desktop:kswarm:team:getOperation',
      'desktop:kswarm:project:create',
      'desktop:kswarm:agent:create',
      'desktop:kswarm:agent:update',
      'desktop:kswarm:agent:archive',
    ]) {
      expect(preload).toContain(channel);
    }
    expect(preload).toContain('sanitizeKSwarmSemanticInput');
    expect(preload).not.toMatch(/planProjectTeam:\s*\(path/);
    expect(preload).not.toMatch(/createKSwarmProject:\s*\(url/);
  });
});
