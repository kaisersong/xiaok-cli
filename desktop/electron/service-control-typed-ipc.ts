import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { resolveServiceControlOutput } from './service-control-snapshot.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { SERVICE_CONTROL_INPUT_SCHEMAS, SERVICE_CONTROL_OUTPUT_SCHEMAS, type ServiceControlMethod } from '../shared/service-control-ipc-contract.js';
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const methods = Object.keys(SERVICE_CONTROL_INPUT_SCHEMAS) as ServiceControlMethod[];
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers | null; installed: Set<ServiceControlMethod> }>();
export function registerServiceControlIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.producers !== producers) throw Error('service_registrar_owner_conflict');
  if (!owner) { owner = { producers, installed: new Set() }; owners.set(ipc, owner); }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:services:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'service_input_invalid');
        if (!SERVICE_CONTROL_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('service_input_invalid');
        return snapshot;
      }), output: SERVICE_CONTROL_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 28,
      sourceFile: 'desktop/electron/service-control-typed-ipc.ts', riskTags: method === 'restart' ? ['external-process', 'internal-mutation'] : ['network'],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('service_runtime_unavailable');
        return resolveServiceControlOutput(method, producer(event, ...args));
      },
    });
    owner.installed.add(method);
  }
}
