import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { z, type ZodTypeAny } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
import type { NativeActor } from './codex-native-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { MODEL_PROVIDER_INPUT_SCHEMAS, MODEL_PROVIDER_OUTPUT_SCHEMAS, type ModelProviderMethod } from '../shared/model-provider-ipc-contract.js';
export function captureModelProviderInput<T>(input: T, schema: ZodTypeAny): T {
  const captured = captureIpcData(input, 'model_config_input_invalid');
  if (!schema.safeParse(captured).success) throw Error('model_config_input_invalid');
  return captured as T;
}
type Service = Pick<ReturnType<typeof createDesktopServices>, ModelProviderMethod>;
type Authorize = (event: unknown) => NativeActor | undefined;
const methods = Object.keys(MODEL_PROVIDER_INPUT_SCHEMAS) as ModelProviderMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;

const configEffects: RiskTag[] = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData'];
export const MODEL_PROVIDER_RISK_TAGS: Readonly<Record<ModelProviderMethod, readonly RiskTag[]>> = Object.freeze({
  getModelConfig: configEffects, getSystemOneConfig: configEffects,
  saveModelConfig: [...configEffects, 'internal-mutation'], updateModelRuntimeOptions: [...configEffects, 'internal-mutation'],
  saveSystemOneConfig: [...configEffects, 'internal-mutation'], deleteProvider: [...configEffects, 'internal-mutation'], deleteModel: [...configEffects, 'internal-mutation'],
  testProviderConnection: [...configEffects, 'network'], listAvailableModelsForProvider: [],
  createManagedXiaokAgent: [...configEffects, 'network', 'exec', 'external-process', 'internal-mutation'],
});
const nativeActors = new AsyncLocalStorage<NativeActor | undefined>();
const owners = new WeakMap<IpcHandleRegistrar, { service: Service | null; authorize?: Authorize; installed: Set<ModelProviderMethod>; registrar: IpcHandleRegistrar }>();
export function registerModelProviderIpc(ipc: IpcHandleRegistrar, rawService?: Service, authorize?: Authorize): void {
  const service = rawService ?? null;
  let owner = owners.get(ipc);
  if (owner && (owner.service !== service || owner.authorize !== authorize)) throw Error('model_config_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, async (event, ...args) => {
        if (!service) throw Error('model_config_runtime_unavailable');
        if (channel !== 'desktop:saveModelConfig') return listener(event, ...args);
        // Capture the existing Main actor producer once, before any wire DTO access.
        const authorized = authorize?.(event);
        const actor = authorized ? { ...captureIpcData(authorized, 'model_config_actor_invalid'), requestSource: 'user' as const } : undefined;
        return nativeActors.run(actor as NativeActor | undefined, () => listener(event, ...args));
      });
    } });
    owner = { service, authorize, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const error = method === 'listAvailableModelsForProvider' ? 'model_config_projection_unavailable' : 'model_config_operation_unknown';
    const capture = (value: unknown) => {
      const snapshot = captureIpcData(value, error);
      if (!MODEL_PROVIDER_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
      return snapshot;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:${method}`, payloadMode: 'tuple', rolloutRound: 18,
      sourceFile: 'desktop/electron/model-provider-typed-ipc.ts', riskTags: [...MODEL_PROVIDER_RISK_TAGS[method]],
      input: z.custom<unknown[]>(() => true).transform(raw => captureModelProviderInput(raw, MODEL_PROVIDER_INPUT_SCHEMAS[method])),
      output: MODEL_PROVIDER_OUTPUT_SCHEMAS[method],
      handler: async (args, event) => {
        if (!service) throw Error('model_config_runtime_unavailable');
        let result: unknown;
        switch (method) {
          case 'getModelConfig': result = service.getModelConfig(); break;
          case 'saveModelConfig': {
            // Existing native selection has a distinct actor guard. A fixed user source cannot replace it.
            const actor = nativeActors.getStore();
            result = service.saveModelConfig(args[0] as Parameters<Service['saveModelConfig']>[0], actor as NativeActor | undefined, 'user'); break;
          }
          case 'updateModelRuntimeOptions': result = service.updateModelRuntimeOptions(args[0] as Parameters<Service['updateModelRuntimeOptions']>[0], 'user'); break;
          case 'getSystemOneConfig': result = service.getSystemOneConfig(); break;
          case 'saveSystemOneConfig': result = service.saveSystemOneConfig(args[0] as Parameters<Service['saveSystemOneConfig']>[0], 'user'); break;
          case 'createManagedXiaokAgent': result = service.createManagedXiaokAgent(args[0] as Parameters<Service['createManagedXiaokAgent']>[0], { requestSource: 'user' }); break;
          case 'testProviderConnection': result = service.testProviderConnection(args[0] as Parameters<Service['testProviderConnection']>[0], 'user'); break;
          case 'listAvailableModelsForProvider': result = service.listAvailableModelsForProvider(args[0] as string); break;
          case 'deleteProvider': result = service.deleteProvider(args[0] as string, { requestSource: 'user' }); break;
          case 'deleteModel': result = service.deleteModel(args[0] as string, { requestSource: 'user' }); break;
        }
        if (!isPromise(result)) return capture(result);
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => { try { resolve(capture(value)); } catch (failure) { reject(failure); } }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
