// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => {
  const BrowserWindow = Object.assign(function BrowserWindow() {}, {
    getAllWindows: () => native.windows,
    fromId: (id: number) => native.windows.find((window) => window.id === id),
    fromWebContents: (contents: unknown) =>
      native.windows.find((window) => window.webContents === contents),
  });
  const api = {
    app: { isReady: () => true, getPath: () => '/owned/userData' },
    BrowserWindow,
    webContents: {
      fromId: (id: number) =>
        native.windows.find((window) => window.webContents.id === id)
          ?.webContents,
    },
  };
  return { default: api, ...api };
});
import * as sourceApi from '../../electron/main-dsh-control-source.js';
const scope = { profileId: 'a'.repeat(64), workspaceId: 'b'.repeat(64) };
const sources: any[] = [];
afterEach(async () => {
  for (const source of sources.splice(0)) await source.drain().catch(() => {});
  native.windows = [];
});
function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    id: 2,
    session: {},
    mainFrame: { url: 'file:///owned/index.html' },
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    id: 1,
    webContents: contents,
    isDestroyed: () => false,
  });
  native.windows = [window];
  const source = sourceApi.createMainDshControlSource({
    window: window as never,
    scope,
    isTrustedUrl: () => true,
  });
  sources.push(source);
  return {
    source: source as any,
    contents,
    event: { sender: contents, senderFrame: contents.mainFrame },
  };
}
it('births an independent Main material event without a DSH Store or borrowed Probe proof', () => {
  const f = fixture(),
    api = sourceApi as Record<string, any>;
  expect(f.source.openMaterialRead).toBeTypeOf('function');
  expect(api.readOriginalMainMaterialEvent).toBeTypeOf('function');
  const body = {
    schemaVersion: 1,
    purpose: 'kb_add_source_file',
    input: {
      collectionId: 'actual-collection',
      kind: 'file',
      title: 'actual file',
      filePath: '/owned/document.docx',
    },
  };
  const frame = f.source.openMaterialRead(f.event, body, 'user');
  const view = api.readOriginalMainMaterialEvent(f.source, frame.proof);
  expect(view.storageScope).toEqual(scope);
  expect(view.body).toEqual(body);
  expect(view.bodyHash).toBe(frame.bodyHash);
  expect(() => f.source.resolve(frame.proof, 'policy_control')).toThrow();
  const probe = f.source.openModelProbe(
    f.event,
    {
      schemaVersion: 1,
      purpose: 'test_provider_connection',
      providerId: 'p',
      modelId: null,
    },
    'user',
  );
  expect(() =>
    api.readOriginalMainMaterialEvent(f.source, probe.proof),
  ).toThrow();
  expect(() => f.source.openMaterialRead(f.event, body, 'agent')).toThrow();
  frame.release();
  expect(() =>
    api.readOriginalMainMaterialEvent(f.source, frame.proof),
  ).toThrow();
});
