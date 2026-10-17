import { types } from 'node:util';
import { z } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { PLUGIN_CATALOG_INPUT_SCHEMAS, PLUGIN_CATALOG_OUTPUT_SCHEMAS, type PluginCatalogMethod } from '../shared/plugin-catalog-ipc-contract.js';
type Service = Pick<ReturnType<typeof createDesktopServices>, PluginCatalogMethod>;
const methods = Object.keys(PLUGIN_CATALOG_INPUT_SCHEMAS) as PluginCatalogMethod[];
const isPromise = types.isPromise, apply = Reflect.apply, nativeThen = Promise.prototype.then;
const risks: Record<PluginCatalogMethod, RiskTag[]> = { listPluginMcpServers: [], listAvailablePlugins: ['network', 'fs-read'], listPluginDependencyStatuses: ['fs-read', 'external-process'] };
const owners = new WeakMap<IpcHandleRegistrar, { service: Service | null; registrar: IpcHandleRegistrar; installed: Set<PluginCatalogMethod> }>();
/** Read-only wire projection; the underlying service retains its existing live getters. */
export function registerPluginCatalogIpc(ipc: IpcHandleRegistrar, rawService?: Service): void {
  const service = rawService ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.service !== service) throw Error('plugin_catalog_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => { if (!service) throw Error('plugin_catalog_runtime_unavailable'); return listener(event, ...args); });
    } });
    owner = { service, registrar, installed: new Set() }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const capture = (raw: unknown): unknown => {
      const snapshot = captureIpcData(raw, 'plugin_catalog_projection_unavailable', { preserveDataPrototype: true });
      if (!PLUGIN_CATALOG_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('plugin_catalog_projection_unavailable');
      return snapshot;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:${method}`,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'plugin_catalog_input_invalid');
        if (!PLUGIN_CATALOG_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('plugin_catalog_input_invalid');
        return snapshot;
      }), output: PLUGIN_CATALOG_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 26,
      sourceFile: 'desktop/electron/plugin-catalog-typed-ipc.ts', riskTags: risks[method],
      handler: async () => {
        if (!service) throw Error('plugin_catalog_runtime_unavailable');
        const result = service[method]();
        if (!isPromise(result)) return capture(result);
        assertStandardIpcPromise(result, 'plugin_catalog_projection_unavailable');
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(capture(value)); } catch (error) { reject(error); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
