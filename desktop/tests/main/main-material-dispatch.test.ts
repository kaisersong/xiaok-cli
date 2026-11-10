// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createHook } from 'node:async_hooks';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { OfficeDocumentParser } from '../../electron/office-document-parser.js';

const native = vi.hoisted(() => ({
  windows: [] as any[],
  userData: '',
  injectPath: '',
  failure: undefined as unknown,
  reads: 0,
}));
vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    readFile: (...args: unknown[]) => {
      const raw = Reflect.apply(actual.readFile, actual, args);
      if (args[0] !== native.injectPath) return raw;
      native.reads++;
      return raw.then(() => {
        throw native.failure;
      });
    },
  };
});
vi.mock('electron', () => {
  const BrowserWindow = Object.assign(function BrowserWindow() {}, {
    getAllWindows: () => native.windows,
    fromId: (id: number) => native.windows.find((w) => w.id === id),
    fromWebContents: (wc: unknown) =>
      native.windows.find((w) => w.webContents === wc),
  });
  const api = {
    app: { isReady: () => true, getPath: () => native.userData },
    BrowserWindow,
    webContents: {
      fromId: (id: number) =>
        native.windows.find((w) => w.webContents.id === id)?.webContents,
    },
  };
  return { default: api, ...api };
});

it.each([
  'actual_dispatch',
  'invalid_import_constructor',
  'unknown_file_outcome',
] as const)(
  'dispatches original Main material without abandoning SDK tails: %s',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'main-material-dispatch-'));
    const previous = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    mkdirSync(process.env.XIAOK_CONFIG_DIR, { mode: 0o700 });
    native.userData = join(root, 'userData');
    mkdirSync(native.userData);
    // Product imports follow the private configuration namespace.
    const { resolveDesktopServiceScope } = await import(
      '../../electron/desktop-service-scope.js'
    );
    const { createMainDshControlSource } = await import(
      '../../electron/main-dsh-control-source.js'
    );
    const { createDesktopServices, readOriginalMainMaterialServicesBinding } =
      await import('../../electron/desktop-services.js');
    const { createKbStoreSqlite } = await import(
      '../../electron/kb-store-sqlite.js'
    );
    const { createSourceExtractor } = await import(
      '../../electron/kb-source-extractor.js'
    );
    const material = await import('../../electron/main-material-source.js');
    const dataRoot = join(root, 'data'),
      scope = resolveDesktopServiceScope({ dataRoot });
    const contents = Object.assign(new EventEmitter(), {
      id: 2,
      session: {},
      mainFrame: { url: 'file:///actual/index.html' },
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
    });
    const window = Object.assign(new EventEmitter(), {
      id: 1,
      webContents: contents,
      isDestroyed: () => false,
    });
    native.windows = [window];
    const user = createMainDshControlSource({
      window: window as never,
      scope: { profileId: scope.profileId, workspaceId: scope.workspaceId },
      isTrustedUrl: () => true,
    });
    const services = createDesktopServices({
      dataRoot,
      materialUserSource: user,
      runner: async () => {},
    });
    const kb = createKbStoreSqlite(join(native.userData, 'knowledge.db'));
    let source: object | undefined;
    try {
      const binding = readOriginalMainMaterialServicesBinding(services, user);
      const extractor = createSourceExtractor({
        officeParser: {
          parse: binding.parseOfficeDocument as OfficeDocumentParser['parse'],
        },
      });
      if (mode === 'invalid_import_constructor') {
        let release!: () => void,
          settled = false,
          raw: object | undefined,
          candidates = 0;
        const held = new Promise<void>((yes) => {
            release = yes;
          }),
          sidecar = Symbol('actual import visible tail');
        const hook = createHook({
          init(_id, type, _trigger, resource) {
            if (
              type !== 'PROMISE' ||
              raw ||
              !new Error().stack?.includes('loadServicesReader') ||
              ++candidates === 1
            )
              return;
            raw = resource;
            Object.defineProperty(resource, 'constructor', {
              value: { held },
              configurable: true,
            });
            Object.defineProperty(resource, sidecar, {
              value: held,
              configurable: true,
            });
          },
        });
        hook.enable();
        let constructing: Promise<object>;
        try {
          constructing = material.createMainMaterialSource({
            userSource: user,
            services,
          });
        } finally {
          hook.disable();
        }
        const observed = constructing.then(
          (value) => {
            settled = true;
            return { value };
          },
          (error) => {
            settled = true;
            return { error };
          },
        );
        try {
          expect(raw).toBeDefined();
          await new Promise((yes) => setTimeout(yes, 20));
          expect(settled).toBe(false);
          expect(
            material.createMainMaterialSource({ userSource: user, services }),
          ).toBe(constructing);
          release();
          expect(await observed).toMatchObject({
            error: expect.objectContaining({
              message: 'MAIN_MATERIAL_IMPORT_UNCONFIRMED',
            }),
          });
          expect(
            material.createMainMaterialSource({ userSource: user, services }),
          ).toBe(constructing);
        } finally {
          release();
        }
        return;
      }
      let release!: () => void,
        settled = false;
      const held = new Promise<void>((yes) => {
          release = yes;
        }),
        sidecar = Symbol('actual fixed export SDK tail');
      Object.defineProperty(readOriginalMainMaterialServicesBinding, sidecar, {
        value: held,
        configurable: true,
      });
      const constructing = material
        .createMainMaterialSource({ userSource: user, services })
        .then((value) => {
          settled = true;
          return value;
        });
      try {
        await new Promise((yes) => setTimeout(yes, 20));
        expect(settled).toBe(false);
        release();
        source = await constructing;
      } finally {
        release();
        delete (
          readOriginalMainMaterialServicesBinding as unknown as Record<
            symbol,
            unknown
          >
        )[sidecar];
      }
      const collection = kb.createCollection(
        {
          name: 'actual',
          description: '',
          embeddingModelId: 'test',
          embeddingDim: 8,
        },
        'user',
      );
      const path = join(root, 'actual.txt');
      writeFileSync(path, 'actual private Main material');
      const input = {
        collectionId: collection.id,
        kind: 'file' as const,
        title: 'actual',
        filePath: path,
      };
      const receipt = kb.addSource(input, 'user');
      const frame = user.openMaterialRead(
        { sender: contents, senderFrame: contents.mainFrame } as never,
        { schemaVersion: 1, purpose: 'kb_add_source_file', input },
        'user',
      );
      try {
        expect(() =>
          material.dispatchSourceExtract(
            source,
            frame.proof,
            kb,
            { ...receipt },
            extractor,
          ),
        ).toThrow();
        let release!: () => void,
          getters = 0,
          completed = false;
        if (mode === 'unknown_file_outcome') {
          const held = new Promise<void>((yes) => {
            release = yes;
          });
          const failure = Error('actual original read outcome');
          Object.defineProperty(failure, Symbol('owned file outcome tail'), {
            value: held,
          });
          Object.defineProperty(failure, 'opaque', {
            get() {
              getters++;
              throw Error('getter must remain inert');
            },
          });
          native.injectPath = path;
          native.failure = failure;
          native.reads = 0;
        }
        const operation = material.dispatchSourceExtract(
          source,
          frame.proof,
          kb,
          receipt,
          extractor,
        );
        expect(
          material.dispatchSourceExtract(
            source,
            frame.proof,
            kb,
            receipt,
            extractor,
          ),
        ).toBe(operation);
        if (mode === 'unknown_file_outcome') {
          const outcome = operation.then(
            (value) => {
              completed = true;
              return { value };
            },
            (error) => {
              completed = true;
              return { error };
            },
          );
          try {
            await new Promise((yes) => setTimeout(yes, 20));
            expect(completed).toBe(false);
            release();
            expect(await outcome).toEqual({ error: native.failure });
            expect(getters).toBe(0);
            expect(native.reads).toBe(1);
            expect(() =>
              material.dispatchSourceExtract(
                source,
                frame.proof,
                kb,
                receipt,
                extractor,
              ),
            ).toThrow();
            expect(native.reads).toBe(1);
          } finally {
            release();
            native.injectPath = '';
            native.failure = undefined;
          }
        } else
          expect(await operation).toMatchObject({
            ok: true,
            text: 'actual private Main material',
          });
      } finally {
        frame.release();
      }
    } finally {
      if (source) {
        if (mode === 'unknown_file_outcome')
          await expect(
            material.sealAndDrainMainMaterialSource(source),
          ).rejects.toThrow('MAIN_MATERIAL_PHYSICAL_UNCONFIRMED');
        else await material.sealAndDrainMainMaterialSource(source);
      }
      kb.close();
      await services.disposeMultiAgent();
      await user.drain();
      native.windows = [];
      if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
      else process.env.XIAOK_CONFIG_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  },
);
