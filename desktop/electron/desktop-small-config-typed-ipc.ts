import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { types } from 'node:util';
import { z } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { SMALL_CONFIG_INPUT_SCHEMAS, SMALL_CONFIG_OUTPUT_SCHEMAS, type DesktopSmallConfigMethod } from '../shared/desktop-small-config-ipc-contract.js';
type Service = Pick<ReturnType<typeof createDesktopServices>, DesktopSmallConfigMethod>;
const readers = new Set<DesktopSmallConfigMethod>(['getSkillDebugConfig', 'getKswarmConfig']);
const methods = Object.keys(SMALL_CONFIG_INPUT_SCHEMAS) as DesktopSmallConfigMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const owners = new WeakMap<IpcHandleRegistrar, { service: Service | null; installed: Set<DesktopSmallConfigMethod>; registrar: IpcHandleRegistrar }>();
export function registerDesktopSmallConfigIpc(ipc: IpcHandleRegistrar, rawService?: Service): void {
  const service = rawService ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.service !== service) throw Error('desktop_config_ipc_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!service) throw Error('desktop_config_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { service, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const error = readers.has(method) ? 'desktop_config_projection_unavailable' : 'desktop_config_operation_unknown';
    const capture = (raw: unknown) => {
      const snapshot = captureIpcData(raw, error);
      if (!SMALL_CONFIG_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
      return snapshot;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:${method}`,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'desktop_config_input_invalid');
        if (!SMALL_CONFIG_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('desktop_config_input_invalid');
        return snapshot;
      }), output: SMALL_CONFIG_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 17,
      sourceFile: 'desktop/electron/desktop-small-config-typed-ipc.ts',
      // loadConfig also tightens permissions and may quarantine a corrupt file.
      riskTags: ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'internal-mutation'],
      handler: async args => {
        if (!service) throw Error('desktop_config_runtime_unavailable');
        const result = method === 'getSkillDebugConfig' ? service.getSkillDebugConfig()
          : method === 'getKswarmConfig' ? service.getKswarmConfig()
            : method === 'saveSkillDebugConfig' ? service.saveSkillDebugConfig(args[0] as { enabled: boolean }, 'user')
              : service.saveKswarmConfig(args[0] as { maxConcurrentTasks: number }, 'user');
        if (!isPromise(result)) return capture(result);
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => {
          apply(nativeThen, result, [(value: unknown) => { try { resolve(capture(value)); } catch (failure) { reject(failure); } }, reject]);
        });
      },
    });
    owner.installed.add(method);
  }
}
