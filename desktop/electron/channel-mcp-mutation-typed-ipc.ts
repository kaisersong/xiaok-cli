// UNREVIEWED CANDIDATE — install at desktop/electron only after owner DESIGN approval.
import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { CHANNEL_MCP_MUTATION_METHODS, CHANNEL_MCP_MUTATION_INPUTS, CHANNEL_MCP_MUTATION_OUTPUTS, CHANNEL_MCP_MUTATION_RISKS } from '../shared/channel-mcp-mutation-ipc-contract.js';
const isPromise = types.isPromise, NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener> | null>();
export function registerChannelMcpMutationIpc(ipc: IpcHandleRegistrar, rawProducers?: ReadonlyMap<string, IpcHandlerListener>): void {
  const producers = rawProducers ?? null;
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('channel_mcp_mutation_registrar_owner_conflict'); return; }
  for (const method of CHANNEL_MCP_MUTATION_METHODS) {
    const channel = 'desktop:' + method, output = CHANNEL_MCP_MUTATION_OUTPUTS[method];
    const capture = (raw: unknown) => {
      const value = captureIpcData(raw, 'channel_mcp_mutation_projection_unavailable');
      if (!output.safeParse(value).success) throw Error('channel_mcp_mutation_projection_unavailable');
      return value;
    };
    registerIpcHandler<unknown[], unknown>({
      registrar: ipc, channel, output, payloadMode: 'tuple', rolloutRound: 34,
      sourceFile: 'desktop/electron/channel-mcp-mutation-typed-ipc.ts', riskTags: [...CHANNEL_MCP_MUTATION_RISKS[method]],
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const value = captureIpcData(raw, 'channel_mcp_mutation_input_invalid');
        if (!CHANNEL_MCP_MUTATION_INPUTS[method].safeParse(value).success) throw Error('channel_mcp_mutation_input_invalid');
        return value;
      }),
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('channel_mcp_mutation_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return capture(result);
        assertStandardIpcPromise(result, 'channel_mcp_mutation_projection_unavailable');
        return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(capture(value)); } catch (error) { reject(error); }
        }, reject]));
      },
    });
  }
  owners.set(ipc, producers);
}
