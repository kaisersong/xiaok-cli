import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactWorkspaceFileError,
  ArtifactWorkspaceFileManager,
  MAX_PACKAGE_FILE_COUNT,
  MAX_PACKAGE_TOTAL_BYTES,
  MAX_SINGLE_FILE_BYTES,
  assertPackageLimits,
  assertSingleFileLimit,
  normalizeSourceIdentityPath,
  validatePackageRelativePath,
} from '../../electron/artifact-workspace-files.js';
import { ArtifactWorkspaceStore } from '../../electron/artifact-workspace-store.js';
import { ArtifactWorkspaceService } from '../../electron/artifact-workspace-service.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskCreateInput, TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('artifact workspace safe file ingestion', () => {
  let rootDir: string;
  let allowedRoot: string;
  let managedRoot: string;
  let manager: ArtifactWorkspaceFileManager;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-artifact-workspace-files-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    allowedRoot = join(rootDir, 'allowed');
    managedRoot = join(rootDir, 'managed');
    mkdirSync(allowedRoot, { recursive: true });
    manager = new ArtifactWorkspaceFileManager({ managedRoot });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('normalizes Windows drive and UNC identities without exposing a source path in the hash', () => {
    expect(normalizeSourceIdentityPath('C:\\Users\\Song\\Report.HTML', 'win32'))
      .toBe('c:/users/song/report.html');
    expect(normalizeSourceIdentityPath('c:/users/song/report.html', 'win32'))
      .toBe('c:/users/song/report.html');
    expect(normalizeSourceIdentityPath('\\\\Server\\Share\\Deck\\INDEX.HTML', 'win32'))
      .toBe('//server/share/deck/index.html');
    expect(normalizeSourceIdentityPath('/Users/Song/Report.HTML', 'posix'))
      .toBe('/Users/Song/Report.HTML');

    const source = join(allowedRoot, 'private-report.html');
    writeFileSync(source, '<h1>private</h1>');
    const identity = manager.resolveSourceIdentity({ sourcePath: source, allowedRoot });
    expect(identity.sourceLocatorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.sourceLocatorHash).not.toContain('private-report');
  });

  it('enforces the fixed single-file and sealed-package boundary constants', () => {
    expect(() => assertSingleFileLimit(MAX_SINGLE_FILE_BYTES)).not.toThrow();
    expect(() => assertSingleFileLimit(MAX_SINGLE_FILE_BYTES + 1)).toThrowWorkspaceFileCode('artifact_too_large');
    expect(() => assertPackageLimits(MAX_PACKAGE_TOTAL_BYTES, MAX_PACKAGE_FILE_COUNT)).not.toThrow();
    expect(() => assertPackageLimits(MAX_PACKAGE_TOTAL_BYTES + 1, 1)).toThrowWorkspaceFileCode('artifact_too_large');
    expect(() => assertPackageLimits(1, MAX_PACKAGE_FILE_COUNT + 1)).toThrowWorkspaceFileCode('artifact_too_large');
  });

  it('copies a single file into deterministic same-root staging and final refs without changing the source', () => {
    const source = join(allowedRoot, 'report.md');
    const sourceBytes = Buffer.from('# Original\n');
    writeFileSync(source, sourceBytes);

    const staged = manager.ingestSingleFile({
      sourcePath: source,
      allowedRoot,
      stagingId: 'stage-1',
      kind: 'markdown',
      mimeType: 'text/markdown',
    });

    expect(staged).toMatchObject({
      storageKind: 'single_file',
      stagingId: 'stage-1',
      stagingRef: 'staging/stage-1/report.md',
      finalRef: 'versions/stage-1/report.md',
      byteSize: sourceBytes.length,
      kind: 'markdown',
      mimeType: 'text/markdown',
    });
    expect(staged.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(source)).toEqual(sourceBytes);

    const finalized = manager.finalize(staged);
    expect(finalized.fileRef).toBe('versions/stage-1/report.md');
    expect(readFileSync(manager.resolveManagedRef(finalized.fileRef))).toEqual(sourceBytes);
    expect(readFileSync(source)).toEqual(sourceBytes);
  });

  it('rejects a source symlink that resolves outside the allowed root', () => {
    const outside = join(rootDir, 'outside.html');
    const link = join(allowedRoot, 'link.html');
    writeFileSync(outside, '<p>outside</p>');
    symlinkSync(outside, link);

    expect(() => manager.resolveSourceIdentity({ sourcePath: link, allowedRoot }))
      .toThrowWorkspaceFileCode('invalid_target');
  });

  it('builds one sorted canonical sealed-package manifest and deterministic checksum', () => {
    const packageRoot = join(allowedRoot, 'slides');
    mkdirSync(join(packageRoot, 'assets'), { recursive: true });
    writeFileSync(join(packageRoot, 'index.html'), '<h1>Slides</h1>');
    writeFileSync(join(packageRoot, 'assets', 'z.txt'), 'z');
    writeFileSync(join(packageRoot, 'assets', 'a.txt'), 'a');

    const staged = manager.ingestSealedPackage({
      sourceDirectory: packageRoot,
      allowedRoot,
      stagingId: 'stage-package',
      entryRef: 'index.html',
      kind: 'slides',
      mimeType: 'application/vnd.xiaok.slides+json',
    });

    expect(staged).toMatchObject({
      storageKind: 'sealed_package',
      stagingRef: 'staging/stage-package',
      finalRef: 'versions/stage-package',
      entryRef: 'index.html',
      packageManifestRef: '.xiaok-manifest.json',
    });
    const manifest = JSON.parse(readFileSync(join(managedRoot, staged.stagingRef, '.xiaok-manifest.json'), 'utf8')) as {
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    expect(manifest.files.map((entry) => entry.path)).toEqual([
      'assets/a.txt',
      'assets/z.txt',
      'index.html',
    ]);
    expect(staged.checksum).toMatch(/^[a-f0-9]{64}$/);

    const finalized = manager.finalize(staged);
    expect(finalized.fileRef).toBe('versions/stage-package');
    expect(readFileSync(join(manager.resolveManagedRef(finalized.fileRef), 'index.html'), 'utf8')).toContain('Slides');
  });

  it('detects same-size tampering and unmanifested files in managed packages', () => {
    const packageRoot = join(allowedRoot, 'verified-package');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, 'index.html'), 'original');
    const finalized = manager.finalize(manager.ingestSealedPackage({
      sourceDirectory: packageRoot,
      allowedRoot,
      stagingId: 'stage-verified-package',
      entryRef: 'index.html',
      kind: 'slides',
      mimeType: 'application/vnd.xiaok.slides+html',
    }));
    expect(manager.verifyManagedArtifact(finalized)).toBe(true);

    const managedEntry = join(manager.resolveManagedRef(finalized.fileRef), 'index.html');
    chmodSync(managedEntry, 0o644);
    writeFileSync(managedEntry, 'modified');
    expect(manager.verifyManagedArtifact(finalized, 'stat')).toBe(true);
    expect(manager.verifyManagedArtifact(finalized)).toBe(false);

    writeFileSync(managedEntry, 'original');
    writeFileSync(join(manager.resolveManagedRef(finalized.fileRef), 'extra.txt'), 'extra');
    expect(manager.verifyManagedArtifact(finalized, 'stat')).toBe(true);
    expect(manager.verifyManagedArtifact(finalized)).toBe(false);
  });

  it('rejects package traversal, symlinks, case-fold collisions and missing entry files', () => {
    expect(() => validatePackageRelativePath('/absolute/index.html')).toThrowWorkspaceFileCode('artifact_package_invalid');
    expect(() => validatePackageRelativePath('../escape.html')).toThrowWorkspaceFileCode('artifact_package_invalid');
    expect(() => validatePackageRelativePath('assets/../../escape.html')).toThrowWorkspaceFileCode('artifact_package_invalid');

    const symlinkPackage = join(allowedRoot, 'symlink-package');
    mkdirSync(symlinkPackage, { recursive: true });
    writeFileSync(join(symlinkPackage, 'index.html'), '<h1>ok</h1>');
    symlinkSync(join(symlinkPackage, 'index.html'), join(symlinkPackage, 'alias.html'));
    expect(() => manager.ingestSealedPackage({
      sourceDirectory: symlinkPackage,
      allowedRoot,
      stagingId: 'stage-symlink',
      entryRef: 'index.html',
      kind: 'html',
      mimeType: 'text/html',
    })).toThrowWorkspaceFileCode('artifact_package_invalid');

    const collisionPackage = join(allowedRoot, 'collision-package');
    mkdirSync(collisionPackage, { recursive: true });
    writeFileSync(join(collisionPackage, 'Index.html'), 'first');
    writeFileSync(join(collisionPackage, 'index.html'), 'second');
    expect(() => manager.ingestSealedPackage({
      sourceDirectory: collisionPackage,
      allowedRoot,
      stagingId: 'stage-collision',
      entryRef: 'index.html',
      kind: 'html',
      mimeType: 'text/html',
    })).toThrowWorkspaceFileCode('artifact_package_invalid');

    const missingEntryPackage = join(allowedRoot, 'missing-entry');
    mkdirSync(missingEntryPackage, { recursive: true });
    writeFileSync(join(missingEntryPackage, 'other.html'), 'other');
    expect(() => manager.ingestSealedPackage({
      sourceDirectory: missingEntryPackage,
      allowedRoot,
      stagingId: 'stage-missing-entry',
      entryRef: 'index.html',
      kind: 'html',
      mimeType: 'text/html',
    })).toThrowWorkspaceFileCode('artifact_package_invalid');
  });
});

describe('artifact workspace service policy and lifecycle', () => {
  let rootDir: string;
  let workspaceRoot: string;
  let managedRoot: string;
  let store: ArtifactWorkspaceStore;
  let snapshotStore: FileTaskSnapshotStore;
  let now: number;
  let prepared: Array<{ taskId: string; input: TaskCreateInput }>;
  let started: string[];
  let cancelled: string[];
  let failNextPrepare: boolean;

  const createService = (flags = { artifactWorkspaceRevisionUi: true, artifactSpatialWorkspace: true }) => {
    let taskSequence = 0;
    return new ArtifactWorkspaceService({
      store,
      snapshotStore,
      fileManager: new ArtifactWorkspaceFileManager({ managedRoot }),
      workspaceRoot,
      featureFlags: flags,
      now: () => now,
      createId: prefix => `${prefix}-${prepared.length + started.length + taskSequence++}`,
      taskHost: {
        async prepareTask(input) {
          if (failNextPrepare) {
            failNextPrepare = false;
            throw new Error('injected prepare failure');
          }
          const taskId = `task-${prepared.length + 1}`;
          prepared.push({ taskId, input });
          await snapshotStore.save({
            taskId,
            sessionId: `session-${taskId}`,
            status: 'understanding',
            prompt: input.prompt,
            materials: [],
            events: [],
            executionScope: input.executionScope,
            createdAt: now,
            updatedAt: now,
          });
          return { taskId };
        },
        async startTask(taskId) { started.push(taskId); },
        async cancelTask(taskId) { cancelled.push(taskId); },
        async recoverTask(taskId) {
          const snapshot = await snapshotStore.recoverTask(taskId);
          if (!snapshot) throw new Error('missing task');
          return { snapshot };
        },
      },
    });
  };

  beforeEach(() => {
    now = Date.UTC(2026, 6, 13, 0, 0, 0);
    rootDir = join(tmpdir(), `xiaok-artifact-workspace-service-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspaceRoot = join(rootDir, 'workspace');
    managedRoot = join(rootDir, 'managed');
    mkdirSync(workspaceRoot, { recursive: true });
    store = new ArtifactWorkspaceStore({ dbPath: join(rootDir, 'workspace.sqlite'), now: () => now });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'tasks'));
    prepared = [];
    started = [];
    cancelled = [];
    failNextPrepare = false;
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('keeps existing revisions readable while feature flags deny new mutation', async () => {
    const service = createService({ artifactWorkspaceRevisionUi: false, artifactSpatialWorkspace: false });
    const snapshot = await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    });
    expect(snapshot.access).toEqual({ revision: 'hidden', spatial: 'hidden' });
    await expect(service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    })).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('allows Phase 0 to remove a draft placeholder while spatial mode is disabled', async () => {
    const service = createService({ artifactWorkspaceRevisionUi: true, artifactSpatialWorkspace: false });
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const removed = await service.removeArtifactWorkspaceNode({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, nodeId: placeholder.id,
      expectedStructureRevision: 1, requestSource: 'user',
    });
    expect(removed.tombstonedAt).toBeDefined();
  });

  it('requires cancelling an active generation before removing its placeholder', async () => {
    const service = createService({ artifactWorkspaceRevisionUi: true, artifactSpatialWorkspace: false });
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });

    await expect(service.removeArtifactWorkspaceNode({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, nodeId: placeholder.id,
      expectedStructureRevision: 1, requestSource: 'user',
    })).rejects.toMatchObject({ code: 'generation_conflict' });
    expect(store.getNode(placeholder.id)?.tombstonedAt).toBeUndefined();

    await service.cancelArtifactGeneration({
      generationRequestId: request.id, conversationId: 'conversation-1',
      workspaceRootId: workspaceRoot, requestSource: 'user',
    });
    const removed = await service.removeArtifactWorkspaceNode({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, nodeId: placeholder.id,
      expectedStructureRevision: 1, requestSource: 'user',
    });
    expect(removed.tombstonedAt).toBeDefined();
  });

  it('default-denies agent and scheduler general mutations and supports typed user nodes', async () => {
    const service = createService();
    await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    });
    await expect(service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'agent',
    })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(service.createArtifactWorkspaceNote({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, noteText: 'scheduler',
      expectedStructureRevision: 0, requestSource: 'scheduler',
    })).rejects.toMatchObject({ code: 'permission_denied' });

    const collection = await service.createArtifactWorkspaceCollection({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, title: 'References',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const note = await service.createArtifactWorkspaceNote({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, noteText: '<script>alert(1)</script>',
      expectedStructureRevision: 1, requestSource: 'user',
    });
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 2, requestSource: 'user',
    });
    const relation = await service.createArtifactWorkspaceRelation({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      fromNodeId: placeholder.id, toNodeId: collection.id, kind: 'references',
      expectedStructureRevision: 3, requestSource: 'user',
    });
    await service.setArtifactCollectionMembership({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      collectionNodeId: collection.id, memberNodeId: placeholder.id, included: true,
      expectedStructureRevision: 4, requestSource: 'user',
    });
    expect(note.noteText).toBe('<script>alert(1)</script>');
    expect(relation.kind).toBe('references');
    expect((await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    })).nodes).toHaveLength(3);
    expect(store.listEvents().filter(event => event.eventName === 'workspace_permission_denied')).toHaveLength(2);
    expect(store.listEvents().filter(event => event.eventName === 'relation_created')).toHaveLength(2);
    expect(store.listAudit().map(entry => entry.action)).toEqual(expect.arrayContaining([
      'general_mutation', 'create_collection', 'create_note', 'create_placeholder',
      'create_relation', 'add_collection_member',
    ]));
    expect(JSON.stringify(store.listAudit())).not.toContain('<script>');
  });

  it('materializes one immutable eligible task artifact idempotently and rejects PDF', async () => {
    const service = createService();
    const htmlPath = join(workspaceRoot, 'task-source', 'report.html');
    mkdirSync(join(workspaceRoot, 'task-source'), { recursive: true });
    writeFileSync(htmlPath, '<h1>Report</h1>');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-source', artifactId: 'artifact-html', kind: 'html', mimeType: 'text/html', filePath: htmlPath,
    }, now);
    const first = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-source', artifactId: 'artifact-html', expectedStructureRevision: 0,
      requestSource: 'user',
    });
    const second = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-source', artifactId: 'artifact-html', expectedStructureRevision: 1,
      requestSource: 'user',
    });
    expect(second.version.id).toBe(first.version.id);
    expect(readFileSync(htmlPath, 'utf8')).toBe('<h1>Report</h1>');

    writeFileSync(htmlPath, '<h1>Report v2</h1>');
    const changed = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-source', artifactId: 'artifact-html', expectedStructureRevision: 1,
      requestSource: 'user',
    });
    expect(changed.lineage.id).toBe(first.lineage.id);
    expect(changed.node.id).toBe(first.node.id);
    expect(changed.version.id).not.toBe(first.version.id);
    expect(store.listVersions(first.lineage.id)).toHaveLength(2);
    expect(readFileSync(new ArtifactWorkspaceFileManager({ managedRoot }).resolveManagedRef(first.version.fileRef), 'utf8'))
      .toBe('<h1>Report</h1>');
    expect(readFileSync(new ArtifactWorkspaceFileManager({ managedRoot }).resolveManagedRef(changed.version.fileRef), 'utf8'))
      .toBe('<h1>Report v2</h1>');

    const pdfPath = join(workspaceRoot, 'task-source', 'report.pdf');
    writeFileSync(pdfPath, '%PDF-1.7');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-pdf', artifactId: 'artifact-pdf', kind: 'pdf', mimeType: 'application/pdf', filePath: pdfPath,
    }, now);
    await expect(service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-pdf', artifactId: 'artifact-pdf', expectedStructureRevision: 1,
      requestSource: 'user',
    })).rejects.toMatchObject({ code: 'artifact_kind_mismatch' });
  });

  it('materializes legacy HTML and image artifacts without recorded MIME when bytes prove their kind', async () => {
    const service = createService();
    const htmlPath = join(workspaceRoot, 'legacy-report.html');
    writeFileSync(htmlPath, '<!doctype html><html><body>Legacy report</body></html>');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-legacy-html', artifactId: 'artifact-legacy-html', kind: 'html', filePath: htmlPath,
    }, now);

    expect(await service.recordEligibleArtifactOpened({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-legacy-html', artifactId: 'artifact-legacy-html',
    })).toBe(true);
    const html = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-legacy-html', artifactId: 'artifact-legacy-html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    expect(html.version).toMatchObject({ kind: 'html', mimeType: 'text/html' });

    const imagePath = join(workspaceRoot, 'legacy-image.png');
    writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-legacy-image', artifactId: 'artifact-legacy-image', kind: 'png', filePath: imagePath,
    }, now);

    expect(await service.recordEligibleArtifactOpened({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-legacy-image', artifactId: 'artifact-legacy-image',
    })).toBe(true);
    const image = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-legacy-image', artifactId: 'artifact-legacy-image',
      expectedStructureRevision: 1, requestSource: 'user',
    });
    expect(image.version).toMatchObject({ kind: 'image', mimeType: 'image/png' });

    const fakeHtmlPath = join(workspaceRoot, 'spoofed.html');
    writeFileSync(fakeHtmlPath, 'not an html document');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-spoofed-html', artifactId: 'artifact-spoofed-html', kind: 'html', filePath: fakeHtmlPath,
    }, now);
    expect(await service.recordEligibleArtifactOpened({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-spoofed-html', artifactId: 'artifact-spoofed-html',
    })).toBe(false);
    await expect(service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-spoofed-html', artifactId: 'artifact-spoofed-html',
      expectedStructureRevision: 2, requestSource: 'user',
    })).rejects.toMatchObject({ code: 'artifact_kind_mismatch' });

    expect(store.listEvents().filter((event) => event.eventName === 'eligible_artifact_opened')).toHaveLength(2);
  });

  it('does not commit lineage, version or final bytes when materialize structure CAS is stale', async () => {
    const service = createService();
    await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const htmlPath = join(workspaceRoot, 'stale-source.html');
    writeFileSync(htmlPath, '<h1>stale</h1>');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-stale', artifactId: 'artifact-stale', kind: 'html', mimeType: 'text/html', filePath: htmlPath,
    }, now);
    await expect(service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-stale', artifactId: 'artifact-stale', expectedStructureRevision: 0,
      requestSource: 'user',
    })).rejects.toMatchObject({ code: 'structure_revision_conflict' });
    const workspace = store.getWorkspaceByConversation('conversation-1')!;
    expect(store.listLineages(workspace.id)).toHaveLength(0);
    expect(store.listNodes(workspace.id)).toHaveLength(1);
  });

  it('materializes, previews and exports a complete sealed slides package', async () => {
    const service = createService();
    const packageRoot = join(workspaceRoot, 'slides-package');
    mkdirSync(join(packageRoot, 'assets'), { recursive: true });
    writeFileSync(join(packageRoot, 'index.html'), '<html><body>Deck</body></html>');
    writeFileSync(join(packageRoot, 'assets', 'theme.css'), 'body { color: navy; }');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-slides', artifactId: 'artifact-slides', kind: 'slides',
      mimeType: 'application/vnd.xiaok.slides+html', filePath: packageRoot,
    }, now);
    const materialized = await service.materializeArtifact({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      sourceTaskId: 'task-slides', artifactId: 'artifact-slides', expectedStructureRevision: 0,
      requestSource: 'user',
    });
    expect(materialized.version).toMatchObject({
      storageKind: 'sealed_package', entryRef: 'index.html', packageManifestRef: '.xiaok-manifest.json',
    });
    const preview = await service.readArtifactWorkspaceVersionPreview({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, versionId: materialized.version.id,
    });
    expect(preview).toMatchObject({ contentKind: 'package_manifest' });
    const exportPath = join(rootDir, 'exported-deck');
    await service.exportArtifactWorkspaceVersion({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      versionId: materialized.version.id, destinationPath: exportPath,
    });
    expect(readFileSync(join(exportPath, 'index.html'), 'utf8')).toContain('Deck');
    expect(readFileSync(join(exportPath, 'assets', 'theme.css'), 'utf8')).toContain('navy');
  });

  it('prepares, binds and only then starts a generation with one immutable lease', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown 报告', requestSource: 'user',
    });
    expect(prepared).toHaveLength(1);
    expect(started).toEqual([prepared[0].taskId]);
    const lease = store.getLeaseByRequest(request.id);
    expect(lease).toMatchObject({ producingTaskId: prepared[0].taskId, requestedKind: 'markdown' });
    expect(prepared[0].input.executionScope).toMatchObject({
      kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease?.id,
      target: {
        workspaceId: expect.any(String), nodeId: placeholder.id, placeholderId: placeholder.id,
        generationRequestId: request.id, leaseId: lease?.id, requestedKind: 'markdown',
        expectedStructureRevision: 1, referenceVersionIds: [],
      },
    });
    expect(prepared[0].input.prompt).toContain('不可变目标描述');
    expect(store.getGenerationRequest(request.id)?.state).toBe('running');
  });

  it('binds collection-member placeholders to the append_collection_item narrow action', async () => {
    const service = createService();
    const collection = await service.createArtifactWorkspaceCollection({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, title: 'Deck',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 1, requestSource: 'user',
    });
    await service.setArtifactCollectionMembership({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      collectionNodeId: collection.id, memberNodeId: placeholder.id, included: true,
      expectedStructureRevision: 2, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 collection item', requestSource: 'user',
    });
    expect(store.getLeaseByRequest(request.id)?.allowedAction).toBe('append_collection_item');
    expect(prepared[0].input.prompt).toContain('artifact_workspace_append_collection_item');
  });

  it('starts a first revision from task/artifact identity without materializing on preview', async () => {
    const service = createService();
    const markdownPath = join(workspaceRoot, 'task-source', 'source.md');
    mkdirSync(join(workspaceRoot, 'task-source'), { recursive: true });
    writeFileSync(markdownPath, '# Source');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: 'task-source', artifactId: 'source-artifact', kind: 'markdown', mimeType: 'text/markdown', filePath: markdownPath,
    }, now);
    const previewSnapshot = await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    });
    expect(previewSnapshot.lineages).toHaveLength(0);

    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      selectedArtifact: { sourceTaskId: 'task-source', artifactId: 'source-artifact', kind: 'markdown', title: 'Source' },
      requestedKind: 'markdown', expectedStructureRevision: 0,
      prompt: '生成一个新版本', requestSource: 'user',
    });
    const snapshot = await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    });
    expect(snapshot.lineages).toHaveLength(1);
    expect(snapshot.nodes.map(node => node.kind).sort()).toEqual(['artifact', 'placeholder']);
    expect(request.sourceVersionId).toBe(snapshot.versions[0].id);
    expect(store.getLeaseByRequest(request.id)?.allowedAction).toBe('append_revision');
    const lease = store.getLeaseByRequest(request.id)!;
    const sourceCopy = join(workspaceRoot, lease.id, 'source', 'source.md');
    expect(prepared[0].input.prompt).toContain(sourceCopy);
    expect(readFileSync(sourceCopy, 'utf8')).toBe('# Source');
  });

  it('rejects a source version owned by another conversation workspace', async () => {
    const service = createService();
    const foreignWorkspace = store.getOrCreateWorkspace({ conversationId: 'conversation-foreign', workspaceRootId: workspaceRoot });
    const foreign = store.createLineageWithVersion({
      workspaceId: foreignWorkspace.id,
      sourceLocatorHash: 'foreign-source',
      version: {
        fileRef: 'versions/foreign/source.md', storageKind: 'single_file', sourceKind: 'materialized_base',
        kind: 'markdown', mimeType: 'text/markdown', checksum: 'a'.repeat(64),
      },
    });
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    await expect(service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      placeholderNodeId: placeholder.id, sourceVersionId: foreign.version.id,
      prompt: '越权 revision', requestSource: 'user',
    })).rejects.toMatchObject({ code: 'artifact_not_found' });
    expect(prepared).toHaveLength(0);
  });

  it('claims only an artifact recorded by the bound task and makes the placeholder ready once', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown 报告', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'generated.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# Generated');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'produced-1', kind: 'markdown', mimeType: 'text/markdown', filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);

    await expect(service.claimProducedArtifact({
      leaseId: lease.id,
      producedArtifactId: 'missing',
      taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    })).rejects.toMatchObject({ code: 'invalid_target' });

    const first = await service.claimProducedArtifact({
      leaseId: lease.id,
      producedArtifactId: 'produced-1',
      taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    });
    const replay = await service.claimProducedArtifact({
      leaseId: lease.id,
      producedArtifactId: 'produced-1',
      taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'task_event',
    });
    expect(replay).toEqual(first);
    expect(store.getGenerationRequest(request.id)?.state).toBe('ready');
    expect(store.getNode(placeholder.id)).toMatchObject({ kind: 'artifact', artifactVersionId: first.versionId });
    expect(store.getLease(lease.id)?.consumedAt).toBeDefined();
  });

  it('does not claim an artifact event until its persisted task snapshot is terminal', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'final.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# Final bytes');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'final', kind: 'markdown', mimeType: 'text/markdown',
      filePath: artifactPath, status: 'running',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    const running = (await snapshotStore.recoverTask(lease.producingTaskId))!;

    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId, eventIndex: 0, event: running.events[0], snapshot: running,
    });
    expect(store.getGenerationRequest(request.id)?.state).toBe('running');
    expect(store.getArtifactClaim(request.id, 'final')).toBeUndefined();

    const completed = {
      ...running,
      status: 'completed' as const,
      events: [...running.events, { type: 'result' as const, result: running.result! }],
      updatedAt: now + 1,
    };
    await snapshotStore.save(completed);
    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId, eventIndex: 1, event: completed.events[1], snapshot: completed,
    });
    expect(store.getGenerationRequest(request.id)?.state).toBe('ready');
    expect(store.getArtifactClaim(request.id, 'final')?.outcomeKind).toBe('ready_version');
  });

  it('accepts TaskHost-projected text kind for a markdown file owned by a markdown lease', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'projected.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# Projected markdown');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'projected-markdown', kind: 'text', filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    const terminal = (await snapshotStore.recoverTask(lease.producingTaskId))!;
    terminal.events.push({ type: 'task_terminal', status: 'completed' });
    await snapshotStore.save(terminal);

    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId,
      eventIndex: terminal.events.length - 1,
      event: terminal.events.at(-1)!,
      snapshot: terminal,
    });

    expect(store.getGenerationRequest(request.id)?.state).toBe('ready');
    expect(store.getArtifactClaim(request.id, 'projected-markdown')?.outcomeKind).toBe('ready_version');
  });

  it.each(['failed', 'cancelled'] as const)('quarantines a persisted artifact when the task terminates as %s', async (status) => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, `${status}.md`);
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, `# ${status}`);
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: `artifact-${status}`, kind: 'markdown', mimeType: 'text/markdown',
      filePath: artifactPath, status,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    const terminal = (await snapshotStore.recoverTask(lease.producingTaskId))!;
    terminal.events.push({ type: 'task_terminal', status });
    await snapshotStore.save(terminal);

    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId,
      eventIndex: terminal.events.length - 1,
      event: terminal.events.at(-1)!,
      snapshot: terminal,
    });

    expect(store.getGenerationRequest(request.id)?.state).toBe(status);
    expect(store.getArtifactClaim(request.id, `artifact-${status}`)?.outcomeKind).toBe('staging');
    expect(store.listVersions(store.getWorkspaceByConversation('conversation-1')!.id)).toHaveLength(0);
    expect(store.listStagingFiles()).toContainEqual(expect.objectContaining({
      generationRequestId: request.id,
      producedArtifactId: `artifact-${status}`,
      availability: 'present',
    }));
  });

  it('maps a missing bundled producer to a stable plugin_unavailable terminal failure', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'slides',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Slides', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const snapshot = (await snapshotStore.recoverTask(lease.producingTaskId))!;
    snapshot.status = 'completed';
    snapshot.result = { summary: 'producer unavailable', artifacts: [], degraded: true };
    snapshot.events = [
      {
        type: 'canvas_tool_result', toolName: 'mcp__slide-renderer__render_slide',
        toolUseId: 'tool-1', ok: false,
        response: JSON.stringify({ ok: false, error: { code: 'plugin_unavailable' } }),
        eventId: 'plugin-unavailable-1',
      },
      { type: 'result', result: snapshot.result },
    ];
    await snapshotStore.save(snapshot);

    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId,
      eventIndex: 1,
      event: snapshot.events[1],
      snapshot,
    });

    expect(store.getGenerationRequest(request.id)).toMatchObject({ state: 'failed', errorCode: 'plugin_unavailable' });
    expect(store.getLease(lease.id)?.cancelledAt).toBeDefined();
    expect(store.listVersions(store.getWorkspaceByConversation('conversation-1')!.id)).toHaveLength(0);
    expect(store.listAudit()).toContainEqual(expect.objectContaining({
      action: 'generation_task_completed', result: 'failed', error_code: 'plugin_unavailable',
    }));
  });

  it('notifies matching renderers when a generation reaches a terminal workspace state', async () => {
    const service = createService();
    const changes: Array<{ conversationId: string; workspaceId: string }> = [];
    const unsubscribe = service.subscribeChanges(change => changes.push(change));
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'ready.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# ready');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'ready', kind: 'markdown', mimeType: 'text/markdown',
      filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);

    await service.claimProducedArtifact({
      leaseId: lease.id, producedArtifactId: 'ready', taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    });
    unsubscribe();

    expect(changes).toEqual([{
      conversationId: 'conversation-1',
      workspaceId: store.getWorkspaceByConversation('conversation-1')!.id,
    }]);
  });

  it('records failed public mutations from a metadata allowlist without prompt or note content', async () => {
    const service = createService();
    await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    let failure: unknown;
    try {
      await service.createArtifactPlaceholder({
        conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
        expectedStructureRevision: 0, requestSource: 'user',
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'structure_revision_conflict' });
    service.recordPublicMutationFailure({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      expectedStructureRevision: 0,
      ...({ prompt: 'private prompt', noteText: 'private note' } as Record<string, unknown>),
    }, 'create_placeholder', failure);

    const audit = store.listAudit().at(-1)!;
    expect(audit).toMatchObject({
      actor_kind: 'user', request_source: 'user', action: 'create_placeholder', result: 'failed',
      error_code: 'structure_revision_conflict', expected_revision: 0, actual_revision: 1,
    });
    expect(JSON.stringify(audit)).not.toContain('private prompt');
    expect(JSON.stringify(audit)).not.toContain('private note');
  });

  it('quarantines a result at the exact lease expiry boundary', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'expired.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# Too late');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'expired', kind: 'markdown', mimeType: 'text/markdown',
      filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    now = Date.parse(lease.expiresAt);

    const outcome = await service.claimProducedArtifact({
      leaseId: lease.id, producedArtifactId: 'expired', taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    });
    expect(outcome).toMatchObject({ outcomeKind: 'staging', quarantineReason: 'expired_lease' });
    expect(store.getGenerationRequest(request.id)?.state).toBe('running');
    expect(store.getLease(lease.id)?.consumedAt).toBeUndefined();
  });

  it('quarantines extension-spoofed image bytes even with an image MIME type', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'image',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 PNG', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'fake.png');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, 'this is not a png');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'fake-image', kind: 'image', mimeType: 'image/png',
      filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);

    const outcome = await service.claimProducedArtifact({
      leaseId: lease.id, producedArtifactId: 'fake-image', taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    });
    expect(outcome).toMatchObject({ outcomeKind: 'staging', quarantineReason: 'kind_mismatch' });
    expect(store.getGenerationRequest(request.id)?.state).toBe('running');
  });

  it('records bundled slide provenance and seals the generated deck as one version package', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'slides',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Slides', requestSource: 'user',
    });
    expect(prepared[0].input.prompt).toContain('mcp__slide-renderer__render_slide');
    expect(prepared[0].input.prompt).toContain('kai-slide-creator');
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'slides.html');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '<section class="slide">Deck</section>');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId,
      artifactId: 'plugin-deck',
      kind: 'other',
      mimeType: 'application/vnd.xiaok.slides+html',
      filePath: artifactPath,
      creator: 'plugin:kai-slide-creator',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);

    const outcome = await service.claimProducedArtifact({
      leaseId: lease.id, producedArtifactId: 'plugin-deck', taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'narrow_tool',
    });
    const version = outcome.versionId ? store.getVersion(outcome.versionId) : undefined;
    expect(version).toMatchObject({
      storageKind: 'sealed_package',
      entryRef: 'index.html',
      pluginSource: 'kai-slide-creator',
      runtimeSource: 'desktop-agent-runtime',
    });
    expect(store.listAudit()).toContainEqual(expect.objectContaining({
      plugin_source: 'kai-slide-creator', result: 'success',
    }));
  });

  it('quarantines a late cancelled result and never revives its lease', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    await service.cancelArtifactGeneration({
      generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestSource: 'user',
    });
    const artifactPath = join(workspaceRoot, lease.id, 'late.html');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '<h1>late</h1>');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'late', kind: 'html', mimeType: 'text/html', filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    const outcome = await service.claimProducedArtifact({
      leaseId: lease.id, producedArtifactId: 'late', taskId: lease.producingTaskId,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
      projectionKind: 'task_event',
    });
    expect(outcome).toMatchObject({ outcomeKind: 'staging', quarantineReason: 'cancelled_late_result' });
    expect(store.getGenerationRequest(request.id)?.state).toBe('cancelled');
    expect(store.getLease(lease.id)?.consumedAt).toBeUndefined();
    expect(cancelled).toEqual([lease.producingTaskId]);
  });

  it('extends a live lease only before expiry and within the fixed total bound', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const originalExpiry = Date.parse(lease.expiresAt);
    const snapshot = (await snapshotStore.recoverTask(lease.producingTaskId))!;
    snapshot.status = 'running';
    now = originalExpiry - 1;
    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId,
      eventIndex: 0,
      event: { type: 'progress', message: 'still running', eventId: 'progress-1' },
      snapshot,
    });
    expect(Date.parse(store.getLease(lease.id)!.expiresAt)).toBe(originalExpiry + 300_000);

    now = Date.parse(store.getLease(lease.id)!.expiresAt) + 1;
    await service.handlePersistedTaskEvent({
      taskId: lease.producingTaskId,
      eventIndex: 1,
      event: { type: 'progress', message: 'too late', eventId: 'progress-2' },
      snapshot,
    });
    expect(Date.parse(store.getLease(lease.id)!.expiresAt)).toBe(originalExpiry + 300_000);
  });

  it('reconciles a same-volume rename that crashed before the staging row was updated', async () => {
    const service = createService();
    const manager = new ArtifactWorkspaceFileManager({ managedRoot });
    const source = join(workspaceRoot, 'crash-source.md');
    writeFileSync(source, '# crash recovery');
    const staged = manager.ingestSingleFile({
      sourcePath: source,
      allowedRoot: workspaceRoot,
      stagingId: 'crashed-rename',
      kind: 'markdown',
      mimeType: 'text/markdown',
    });
    const row = store.createStagingFile({
      source: 'materialize',
      sourceLocatorHash: manager.resolveSourceIdentity({ sourcePath: source, allowedRoot: workspaceRoot }).sourceLocatorHash,
      availability: 'present',
      fileRef: staged.stagingRef,
      owner: 'system_staging',
      keep: false,
      expiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
    });
    manager.finalize(staged);

    await service.reconcileStartup();

    expect(store.getStagingFile(row.id)).toMatchObject({
      fileRef: staged.finalRef,
      quarantineReason: 'commit_recovery',
    });
  });

  it('preserves terminal cancellation during startup reconciliation', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 Markdown', requestSource: 'user',
    });
    const lease = store.getLeaseByRequest(request.id)!;
    const artifactPath = join(workspaceRoot, lease.id, 'late.md');
    mkdirSync(join(workspaceRoot, lease.id), { recursive: true });
    writeFileSync(artifactPath, '# late');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: lease.producingTaskId, artifactId: 'late-after-cancel', kind: 'markdown', mimeType: 'text/markdown',
      filePath: artifactPath,
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: request.id, leaseId: lease.id },
    }, now);
    await service.cancelArtifactGeneration({
      generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      requestSource: 'user',
    });

    await service.reconcileStartup();

    expect(store.getGenerationRequest(request.id)?.state).toBe('cancelled');
    expect(store.getArtifactClaim(request.id, 'late-after-cancel')).toBeUndefined();
    const snapshot = await service.getArtifactWorkspaceSnapshot({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, viewKey: 'primary',
    });
    expect(snapshot.versions).toHaveLength(0);
  });

  it('moves a stale nonterminal in-process task to needs_recovery on startup', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });

    await service.reconcileStartup();

    expect(store.getGenerationRequest(request.id)).toMatchObject({
      state: 'needs_recovery', errorCode: 'runtime_unavailable',
    });
    expect(store.listEvents().some(event => (
      event.eventName === 'recovery_attempted' && event.requestId === request.id
    ))).toBe(true);

    const retried = await service.retryArtifactGeneration({
      generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      prompt: '重试 HTML', requestSource: 'user',
    });
    expect(store.getGenerationRequest(request.id)?.state).toBe('superseded');
    expect(retried).toMatchObject({ state: 'running', supersedesRequestId: request.id });
  });

  it('isolates a broken task recovery, records recovery_failed, and continues with later requests', async () => {
    const service = createService();
    const firstPlaceholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const firstRequest = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: firstPlaceholder.id,
      prompt: 'broken recovery', requestSource: 'user',
    });
    const secondPlaceholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'markdown',
      expectedStructureRevision: 1, requestSource: 'user',
    });
    const secondRequest = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: secondPlaceholder.id,
      prompt: 'healthy recovery', requestSource: 'user',
    });
    const secondLease = store.getLeaseByRequest(secondRequest.id)!;
    const artifactPath = join(workspaceRoot, secondLease.id, 'result.md');
    mkdirSync(join(workspaceRoot, secondLease.id), { recursive: true });
    writeFileSync(artifactPath, '# recovered');
    await saveArtifactSnapshot(snapshotStore, {
      taskId: secondLease.producingTaskId,
      artifactId: 'artifact-recovered',
      kind: 'markdown',
      mimeType: 'text/markdown',
      filePath: artifactPath,
      executionScope: {
        kind: 'artifact_workspace_generation', generationRequestId: secondRequest.id, leaseId: secondLease.id,
      },
    }, now);
    const firstTaskId = store.getLeaseByRequest(firstRequest.id)!.producingTaskId;
    const recoverTask = snapshotStore.recoverTask.bind(snapshotStore);
    snapshotStore.recoverTask = async (taskId) => {
      if (taskId === firstTaskId) throw new Error('injected corrupt snapshot');
      return recoverTask(taskId);
    };

    await expect(service.reconcileStartup()).resolves.toBeUndefined();

    expect(store.getGenerationRequest(firstRequest.id)).toMatchObject({
      state: 'needs_recovery', errorCode: 'runtime_unavailable',
    });
    expect(store.getGenerationRequest(secondRequest.id)?.state).toBe('ready');
    expect(store.listEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: 'recovery_failed', requestId: firstRequest.id }),
      expect.objectContaining({ eventName: 'recovery_succeeded', requestId: secondRequest.id }),
    ]));
  });

  it('allows only one concurrent retry to reserve a superseded request', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });
    await service.reconcileStartup();

    const outcomes = await Promise.allSettled([
      service.retryArtifactGeneration({
        generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
        prompt: '并发重试 A', requestSource: 'user',
      }),
      service.retryArtifactGeneration({
        generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
        prompt: '并发重试 B', requestSource: 'user',
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'generation_conflict' }),
    });
    expect(store.getGenerationRequest(request.id)?.state).toBe('superseded');
    expect(store.listGenerationRequests(request.workspaceId).filter((candidate) => candidate.supersedesRequestId === request.id)).toHaveLength(1);
  });

  it('leaves the reserved retry failed and the old request superseded when task preparation fails', async () => {
    const service = createService();
    const placeholder = await service.createArtifactPlaceholder({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, requestedKind: 'html',
      expectedStructureRevision: 0, requestSource: 'user',
    });
    const request = await service.submitArtifactGeneration({
      conversationId: 'conversation-1', workspaceRootId: workspaceRoot, placeholderNodeId: placeholder.id,
      prompt: '生成 HTML', requestSource: 'user',
    });
    await service.reconcileStartup();
    failNextPrepare = true;

    await expect(service.retryArtifactGeneration({
      generationRequestId: request.id, conversationId: 'conversation-1', workspaceRootId: workspaceRoot,
      prompt: '准备失败的重试', requestSource: 'user',
    })).rejects.toMatchObject({ code: 'runtime_unavailable' });

    expect(store.getGenerationRequest(request.id)?.state).toBe('superseded');
    expect(store.listGenerationRequests(request.workspaceId)).toContainEqual(expect.objectContaining({
      supersedesRequestId: request.id,
      state: 'failed',
      errorCode: 'runtime_unavailable',
    }));
  });
});

async function saveArtifactSnapshot(
  store: FileTaskSnapshotStore,
  input: {
    taskId: string;
    artifactId: string;
    kind: string;
    mimeType?: string;
    filePath: string;
    status?: TaskSnapshot['status'];
    creator?: string;
    executionScope?: TaskSnapshot['executionScope'];
  },
  now: number,
): Promise<void> {
  await store.save({
    taskId: input.taskId,
    sessionId: `session-${input.taskId}`,
    status: input.status ?? 'completed',
    prompt: 'artifact',
    materials: [],
    executionScope: input.executionScope,
    events: [{
      type: 'artifact_recorded', artifactId: input.artifactId, kind: input.kind, label: input.artifactId,
      filePath: input.filePath, previewAvailable: true, turnId: 'turn-1', mimeType: input.mimeType,
      creator: input.creator,
    }],
    result: {
      summary: 'done',
      artifacts: [{
        artifactId: input.artifactId, kind: input.kind as never, title: input.artifactId,
        createdAt: new Date(now).toISOString(), previewAvailable: true,
        filePath: input.filePath, mimeType: input.mimeType, creator: input.creator,
      }],
    },
    createdAt: now,
    updatedAt: now,
  });
}

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toThrowWorkspaceFileCode(code: ArtifactWorkspaceFileError['code']): T;
  }
}

expect.extend({
  toThrowWorkspaceFileCode(received: () => unknown, code: ArtifactWorkspaceFileError['code']) {
    try {
      received();
      return { pass: false, message: () => `expected function to throw ${code}` };
    } catch (error) {
      const pass = error instanceof ArtifactWorkspaceFileError && error.code === code;
      return {
        pass,
        message: () => `expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
