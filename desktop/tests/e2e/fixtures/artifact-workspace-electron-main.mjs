import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(fixtureDir, '..', '..', '..');
const compiledElectronRoot = join(desktopRoot, 'dist', 'main', 'desktop', 'electron');
const userData = process.env.XIAOK_E2E_USER_DATA;
if (userData) app.setPath('userData', userData);

console.log('[artifact-workspace-e2e-main] importing compiled services');
const { createDesktopServices } = await import(pathToFileURL(join(compiledElectronRoot, 'desktop-services.js')).href);
const { registerDesktopIpc } = await import(pathToFileURL(join(compiledElectronRoot, 'ipc.js')).href);
const { buildBrowserWindowOptions } = await import(pathToFileURL(join(compiledElectronRoot, 'security.js')).href);
console.log('[artifact-workspace-e2e-main] compiled services imported');

function createKSwarmStub() {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'onStatusChange') return () => () => {};
      if (property === 'getStatus') return () => ({ running: false, reachable: false });
      return async () => ({ ok: true, projects: [], tasks: [] });
    },
  });
}

function createWindow(title) {
  const window = new BrowserWindow({
    ...buildBrowserWindowOptions(join(compiledElectronRoot, 'preload.cjs')),
    show: false,
    title,
  });
  const html = `<!doctype html><html><head><title>${title}</title></head><body><main>${title}</main></body></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return window;
}

app.whenReady().then(async () => {
  console.log('[artifact-workspace-e2e-main] app ready');
  const dataRoot = join(app.getPath('userData'), 'artifact-workspace-e2e-data');
  const services = createDesktopServices({
    dataRoot,
    kswarmService: createKSwarmStub(),
    artifactWorkspaceFeatureFlags: {
      artifactWorkspaceRevisionUi: true,
      artifactSpatialWorkspace: true,
    },
    runner: async ({ sessionId, executionScope, emitRuntimeEvent }) => {
      if (executionScope?.kind !== 'artifact_workspace_generation') return;
      const leaseId = executionScope.leaseId;
      console.log(`[artifact-workspace-e2e-main] runner started ${leaseId}`);
      const outputDir = join(dataRoot, 'artifact-workspace', 'generation', leaseId);
      const outputPath = join(outputDir, 'generated.md');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(outputPath, '# Generated in the real Electron task host\n', 'utf8');
      emitRuntimeEvent({
        type: 'artifact_recorded',
        sessionId,
        turnId: `turn-${leaseId}`,
        intentId: `intent-${leaseId}`,
        stageId: `stage-${leaseId}`,
        artifactId: `artifact-${leaseId}`,
        label: 'generated.md',
        kind: 'markdown',
        path: outputPath,
        creator: 'agent:e2e',
      });
      console.log(`[artifact-workspace-e2e-main] artifact emitted ${leaseId}`);
    },
  });
  console.log('[artifact-workspace-e2e-main] services created');

  const primary = createWindow('artifact-primary');
  console.log('[artifact-workspace-e2e-main] primary created');
  await registerDesktopIpc(ipcMain, primary, services);
  console.log('[artifact-workspace-e2e-main] IPC registered');
  createWindow('artifact-secondary');
  console.log('[artifact-workspace-e2e-main] secondary created');
}).catch((error) => {
  console.error('[artifact-workspace-e2e-main] startup failed', error);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
