#!/usr/bin/env node
/**
 * Storage-level E2E companion: independent workspace clients must converge
 * when they move different nodes while an agent connection appends a revision.
 *
 * This intentionally uses three real ArtifactWorkspaceStore connections to
 * one SQLite database. The complementary real BrowserWindow/preload/IPC path
 * is covered by tests/e2e/artifact-workspace-multi-window.spec.ts.
 *
 * Usage: node tests/e2e-artifact-workspace-multi-window.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = dirname(testsDir);
const compiledStorePath = join(
  desktopDir,
  'dist',
  'main',
  'desktop',
  'electron',
  'artifact-workspace-store.js',
);

function canonicalSnapshot(store, workspaceId) {
  const workspace = store.getWorkspace(workspaceId);
  assert.ok(workspace, `workspace ${workspaceId} must exist`);

  const lineages = store.listLineages(workspaceId);
  return {
    workspace,
    nodes: store.listNodes(workspaceId).sort((left, right) => left.id.localeCompare(right.id)),
    relations: store.listRelations(workspaceId).sort((left, right) => left.id.localeCompare(right.id)),
    lineages: lineages.sort((left, right) => left.id.localeCompare(right.id)),
    versions: lineages
      .flatMap((lineage) => store.listVersions(lineage.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function nodeFrom(snapshot, nodeId) {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `node ${nodeId} must exist in snapshot`);
  return node;
}

async function loadStore() {
  if (!existsSync(compiledStorePath)) {
    throw new Error(
      `Missing compiled ArtifactWorkspaceStore at ${compiledStorePath}. Run \`npm run build:main\` first.`,
    );
  }
  const module = await import(pathToFileURL(compiledStorePath).href);
  assert.equal(typeof module.ArtifactWorkspaceStore, 'function');
  return module.ArtifactWorkspaceStore;
}

async function main() {
  const ArtifactWorkspaceStore = await loadStore();
  const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-artifact-workspace-multi-window-'));
  const dbPath = join(rootDir, 'workspace.db');
  const stores = [];
  let summary;

  try {
    const windowA = new ArtifactWorkspaceStore({ dbPath });
    const windowB = new ArtifactWorkspaceStore({ dbPath });
    const agentProjection = new ArtifactWorkspaceStore({ dbPath });
    stores.push(windowA, windowB, agentProjection);

    const workspace = windowA.getOrCreateWorkspace({
      conversationId: 'e2e-conversation',
      workspaceRootId: 'e2e-root-opaque',
    });
    const base = windowA.createLineageWithVersion({
      workspaceId: workspace.id,
      sourceLocatorHash: 'a'.repeat(64),
      version: {
        fileRef: 'versions/base/report.md',
        storageKind: 'single_file',
        sourceKind: 'materialized_base',
        kind: 'markdown',
        mimeType: 'text/markdown',
        byteSize: 12,
        checksum: 'b'.repeat(64),
      },
    });
    const artifactNode = windowA.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'artifact',
        lineageId: base.lineage.id,
        artifactVersionId: base.version.id,
        owner: 'user',
        title: 'Report',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    }).node;
    const noteNode = windowA.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 1,
      node: {
        kind: 'note',
        owner: 'user',
        noteText: 'Move independently',
        x: 400,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 1,
      },
    }).node;

    // Each renderer observes the same canonical starting point, then keeps only
    // the layout revision of the node it owns optimistically.
    const observedByA = canonicalSnapshot(windowA, workspace.id);
    const observedByB = canonicalSnapshot(windowB, workspace.id);
    assert.equal(observedByA.workspace.structureRevision, 2);
    assert.equal(observedByB.workspace.structureRevision, 2);
    assert.equal(nodeFrom(observedByA, artifactNode.id).layoutRevision, 0);
    assert.equal(nodeFrom(observedByB, noteNode.id).layoutRevision, 0);

    const [updatedByA, updatedByB, revision] = await Promise.all([
      Promise.resolve().then(() => windowA.updateLayout({
        workspaceId: workspace.id,
        patches: [{
          nodeId: artifactNode.id,
          x: 40,
          y: 60,
          zIndex: 2,
          expectedLayoutRevision: nodeFrom(observedByA, artifactNode.id).layoutRevision,
        }],
      })),
      Promise.resolve().then(() => windowB.updateLayout({
        workspaceId: workspace.id,
        patches: [{
          nodeId: noteNode.id,
          x: 460,
          y: 90,
          zIndex: 3,
          expectedLayoutRevision: nodeFrom(observedByB, noteNode.id).layoutRevision,
        }],
      })),
      Promise.resolve().then(() => agentProjection.appendVersion({
        lineageId: base.lineage.id,
        parentVersionId: base.version.id,
        version: {
          fileRef: 'versions/task-agent/revision.md',
          storageKind: 'single_file',
          sourceKind: 'workspace_generation',
          sourceArtifactId: 'artifact-agent-revision',
          kind: 'markdown',
          mimeType: 'text/markdown',
          byteSize: 24,
          checksum: 'c'.repeat(64),
          producingTaskId: 'task-agent',
          producingAgentId: 'agent-e2e',
        },
      })),
    ]);

    assert.deepEqual({
      x: updatedByA[0].x,
      y: updatedByA[0].y,
      zIndex: updatedByA[0].zIndex,
      layoutRevision: updatedByA[0].layoutRevision,
    }, {
      x: 40,
      y: 60,
      zIndex: 2,
      layoutRevision: 1,
    });
    assert.deepEqual({
      x: updatedByB[0].x,
      y: updatedByB[0].y,
      zIndex: updatedByB[0].zIndex,
      layoutRevision: updatedByB[0].layoutRevision,
    }, {
      x: 460,
      y: 90,
      zIndex: 3,
      layoutRevision: 1,
    });
    assert.equal(revision.parentVersionId, base.version.id);
    assert.equal(revision.producingTaskId, 'task-agent');

    const finalA = canonicalSnapshot(windowA, workspace.id);
    const finalB = canonicalSnapshot(windowB, workspace.id);
    const finalAgent = canonicalSnapshot(agentProjection, workspace.id);

    assert.equal(finalA.workspace.structureRevision, 2, 'layout/revision writes must not bump structure CAS');
    assert.deepEqual(finalA, finalB, 'window B must converge to window A after canonical refresh');
    assert.deepEqual(finalA, finalAgent, 'agent projection connection must observe the same canonical snapshot');
    assert.deepEqual(
      nodeFrom(finalA, artifactNode.id),
      nodeFrom(finalB, artifactNode.id),
      'artifact node must converge across windows',
    );
    assert.deepEqual(
      nodeFrom(finalA, noteNode.id),
      nodeFrom(finalB, noteNode.id),
      'note node must converge across windows',
    );
    assert.deepEqual(
      finalA.versions.map((version) => version.id).sort(),
      [base.version.id, revision.id].sort(),
      'both immutable revisions must be visible in the converged snapshot',
    );
    summary = {
      artifactNodeId: artifactNode.id,
      noteNodeId: noteNode.id,
      revisionCount: finalA.versions.length,
      structureRevision: finalA.workspace.structureRevision,
    };
  } finally {
    for (const store of stores.reverse()) {
      try {
        store.close();
      } catch {
        // Continue closing remaining handles before cross-platform cleanup.
      }
    }
    rmSync(rootDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }

  assert.equal(existsSync(rootDir), false, 'temporary SQLite directory must be removed');
  assert.ok(summary, 'the multi-window scenario must finish before cleanup');
  console.log('[e2e-artifact-workspace] PASS');
  console.log(`[e2e-artifact-workspace] layout updates: ${summary.artifactNodeId}=1, ${summary.noteNodeId}=1`);
  console.log(`[e2e-artifact-workspace] revisions: ${summary.revisionCount}; structureRevision: ${summary.structureRevision}`);
  console.log('[e2e-artifact-workspace] three SQLite connections converged');
}

main().catch((error) => {
  console.error('[e2e-artifact-workspace] FAIL', error);
  process.exitCode = 1;
});
