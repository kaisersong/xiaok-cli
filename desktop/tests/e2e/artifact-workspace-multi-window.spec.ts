import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(TEST_DIR, '..', '..');
const ENTRY = join(TEST_DIR, 'fixtures', 'artifact-workspace-electron-main.mjs');
const describeE2E = process.env.XIAOK_E2E ? test.describe : test.describe.skip;

describeE2E('artifact workspace real two-window convergence', () => {
  let app: ElectronApplication;
  let primary: Page;
  let secondary: Page;
  let userData: string;

  test.beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'xiaok-artifact-workspace-electron-e2e-'));
    app = await electron.launch({
      args: [ENTRY],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        XIAOK_E2E_USER_DATA: userData,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
    });
    app.process().stdout?.on('data', chunk => process.stdout.write(`[electron-stdout] ${String(chunk)}`));
    app.process().stderr?.on('data', chunk => process.stderr.write(`[electron-stderr] ${String(chunk)}`));
    await expect.poll(() => app.windows().length).toBe(2);
    const windows = app.windows();
    for (const page of windows) await page.waitForLoadState('domcontentloaded');
    primary = windows.find(page => page.url().includes('artifact-primary')) ?? windows[0];
    secondary = windows.find(page => page.url().includes('artifact-secondary')) ?? windows[1];
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  test('keeps independent layouts convergent while task completion projects a revision', async () => {
    const conversationId = `electron-e2e-${Date.now()}`;
    const initial = await primary.evaluate(async (conversationId) => (
      window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId })
    ), conversationId);
    expect(initial).toMatchObject({ ok: true, data: { workspace: { structureRevision: 0 } } });

    const first = await primary.evaluate(async ({ conversationId }) => (
      window.xiaokDesktop?.createArtifactWorkspaceNote({
        conversationId,
        noteText: 'Primary-owned node',
        x: 0,
        y: 0,
        expectedStructureRevision: 0,
      })
    ), { conversationId });
    const second = await primary.evaluate(async ({ conversationId }) => (
      window.xiaokDesktop?.createArtifactWorkspaceNote({
        conversationId,
        noteText: 'Secondary-owned node',
        x: 400,
        y: 0,
        expectedStructureRevision: 1,
      })
    ), { conversationId });
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });

    const observed = await secondary.evaluate(async (conversationId) => (
      window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId })
    ), conversationId);
    expect(observed).toMatchObject({ ok: true, data: { workspace: { structureRevision: 2 } } });
    const nodes = (observed as { data: { nodes: Array<{ id: string; noteText?: string; layoutRevision: number }> } }).data.nodes;
    const primaryNode = nodes.find(node => node.noteText === 'Primary-owned node');
    const secondaryNode = nodes.find(node => node.noteText === 'Secondary-owned node');
    expect(primaryNode).toBeTruthy();
    expect(secondaryNode).toBeTruthy();

    await secondary.evaluate(() => {
      const target = window as typeof window & { artifactWorkspaceChanges?: Array<{ conversationId: string; workspaceId: string }> };
      target.artifactWorkspaceChanges = [];
      window.xiaokDesktop?.onArtifactWorkspaceChanged((change) => target.artifactWorkspaceChanges?.push(change));
    });

    const [movedByPrimary, movedBySecondary] = await Promise.all([
      primary.evaluate(async ({ conversationId, nodeId, expectedLayoutRevision }) => (
        window.xiaokDesktop?.updateArtifactWorkspaceLayout({
          conversationId,
          patches: [{ nodeId, x: 40, y: 60, zIndex: 2, expectedLayoutRevision }],
        })
      ), { conversationId, nodeId: primaryNode!.id, expectedLayoutRevision: primaryNode!.layoutRevision }),
      secondary.evaluate(async ({ conversationId, nodeId, expectedLayoutRevision }) => (
        window.xiaokDesktop?.updateArtifactWorkspaceLayout({
          conversationId,
          patches: [{ nodeId, x: 460, y: 90, zIndex: 3, expectedLayoutRevision }],
        })
      ), { conversationId, nodeId: secondaryNode!.id, expectedLayoutRevision: secondaryNode!.layoutRevision }),
    ]);
    expect(movedByPrimary).toMatchObject({ ok: true });
    expect(movedBySecondary).toMatchObject({ ok: true });

    const beforePlaceholder = await primary.evaluate(async (conversationId) => (
      window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId })
    ), conversationId) as { data: { workspace: { structureRevision: number } } };
    const placeholderResult = await primary.evaluate(async ({ conversationId, expectedStructureRevision }) => (
      window.xiaokDesktop?.createArtifactPlaceholder({
        conversationId,
        requestedKind: 'markdown',
        title: 'Generated report',
        x: 800,
        y: 0,
        expectedStructureRevision,
      })
    ), { conversationId, expectedStructureRevision: beforePlaceholder.data.workspace.structureRevision });
    expect(placeholderResult).toMatchObject({ ok: true });
    const placeholder = (placeholderResult as { data: { nodes: Array<{ id: string; kind: string }> } }).data.nodes
      .find(node => node.kind === 'placeholder');
    expect(placeholder).toBeTruthy();

    const submitted = await primary.evaluate(async ({ conversationId, placeholderNodeId }) => (
      window.xiaokDesktop?.submitArtifactGeneration({
        conversationId,
        placeholderNodeId,
        prompt: 'Generate one deterministic Markdown artifact.',
      })
    ), { conversationId, placeholderNodeId: placeholder!.id });
    expect(submitted).toMatchObject({ ok: true });

    await expect.poll(async () => secondary.evaluate((conversationId) => {
      const target = window as typeof window & { artifactWorkspaceChanges?: Array<{ conversationId: string }> };
      return target.artifactWorkspaceChanges?.filter(change => change.conversationId === conversationId).length ?? 0;
    }, conversationId)).toBeGreaterThan(0);

    await expect.poll(async () => secondary.evaluate(async (conversationId) => {
      const result = await window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId });
      return result?.ok ? result.data.generationRequests.map(request => request.state) : [];
    }, conversationId)).toContain('ready');

    const [finalPrimary, finalSecondary] = await Promise.all([
      primary.evaluate(async (conversationId) => window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId }), conversationId),
      secondary.evaluate(async (conversationId) => window.xiaokDesktop?.getArtifactWorkspaceSnapshot({ conversationId }), conversationId),
    ]);
    expect(finalPrimary).toEqual(finalSecondary);
    const finalSnapshot = (finalPrimary as {
      data: {
        workspace: { structureRevision: number };
        nodes: Array<{ id: string; kind: string; x: number; y: number; layoutRevision: number }>;
        versions: Array<{ sourceKind: string; status: string }>;
      };
    }).data;
    expect(finalSnapshot.nodes.find(node => node.id === primaryNode!.id)).toMatchObject({ x: 40, y: 60, layoutRevision: 1 });
    expect(finalSnapshot.nodes.find(node => node.id === secondaryNode!.id)).toMatchObject({ x: 460, y: 90, layoutRevision: 1 });
    expect(finalSnapshot.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'artifact' })]));
    expect(finalSnapshot.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'workspace_generation', status: 'ready' }),
    ]));
    expect(finalSnapshot.workspace.structureRevision).toBe(4);
  });
});
