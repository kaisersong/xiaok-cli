import { z } from 'zod';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import type { LoopOutputService } from './loop-output-service.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { executionIdentity } from './loop-verification-execution.js';
import { parseLoopArtifactPageRequest } from './loop-published-artifacts.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { LOOP_OUTPUT_SCHEMAS, type LoopOutputMethod } from '../shared/loop-output-ipc-contract.js';
import type { LoopArtifactPageRequest } from '../shared/loop-artifacts.js';

export const LOOP_OUTPUT_CHANNELS = Object.freeze({
  listPublishedArtifacts: 'desktop:loops:listPublishedArtifacts',
  readOutputPreview: 'desktop:loops:readOutputPreview',
  readTaskResult: 'desktop:loops:readTaskResult',
  openOutputDirectory: 'desktop:loops:openOutputDirectory',
} as const);
type Input = [string] | [string, LoopArtifactPageRequest];
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const byChannel = new Map<string, LoopOutputMethod>(Object.entries(LOOP_OUTPUT_CHANNELS)
  .map(([method, channel]) => [channel, method as LoopOutputMethod]));
const adapters = new WeakMap<IpcHandleRegistrar, Readonly<{
  service: LoopOutputService; authorize: (event: unknown) => boolean; registrar: IpcHandleRegistrar;
}>>();
// Protected reads consult the authenticated installed controller and its actual
// native currentness/payload readers, retaining their real transport lifetimes.
const protectedReadRisks: RiskTag[] = ['fs-read', 'network', 'capability-token', 'internal-mutation', 'external-process'];
const risks: Record<LoopOutputMethod, RiskTag[]> = {
  listPublishedArtifacts: [...protectedReadRisks],
  readOutputPreview: [...protectedReadRisks],
  // The original TaskHost/workflow recovery may query or execute and reconcile
  // local durable task state. It is not replaced with a snapshot-only reader.
  readTaskResult: [...protectedReadRisks, 'exec', 'fs-write-userData'],
  openOutputDirectory: [...protectedReadRisks, 'fs-write', 'shell-open'],
};
function admitted(ipc: IpcHandleRegistrar, service: LoopOutputService,
  authorize: (event: unknown) => boolean): IpcHandleRegistrar {
  const old = adapters.get(ipc);
  if (old) {
    if (old.service !== service || old.authorize !== authorize) throw Error('loop_output_ipc_registrar_owner_conflict');
    return old.registrar;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    const method = byChannel.get(channel);
    if (!method) throw Error('loop_output_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (!authorize(event) || args.length !== (method === 'listPublishedArtifacts' ? 2 : 1))
        throw Error('loop_output_ipc_denied');
      return listener(event, ...args);
    });
  } });
  adapters.set(ipc, Object.freeze({ service, authorize, registrar }));
  return registrar;
}
function inputSchema(method: LoopOutputMethod) {
  return z.custom<Input>(() => true).transform(raw => {
    const value = captureIpcData(raw, 'loop_output_ipc_input', captureOptions);
    executionIdentity(value[0]);
    if (method === 'listPublishedArtifacts') parseLoopArtifactPageRequest(value[1]);
    return value;
  });
}
export function registerLoopOutputIpc(ipc: IpcHandleRegistrar, service: LoopOutputService,
  authorize: (event: unknown) => boolean): void {
  const registrar = admitted(ipc, service, authorize);
  for (const [key, channel] of Object.entries(LOOP_OUTPUT_CHANNELS)) {
    const method = key as LoopOutputMethod, output = LOOP_OUTPUT_SCHEMAS[method];
    registerIpcHandler<Input, unknown>({ registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/loop-output-ipc.ts', rolloutRound: 7, riskTags: risks[method],
      handler: async input => {
        const result = method === 'listPublishedArtifacts'
          ? await service.listPublishedArtifacts({ loopId: input[0], page: input[1]!, requestSource: 'user' })
          : await service[method]({ loopId: input[0], requestSource: 'user' });
        let captured: unknown;
        try { captured = captureIpcData(result, 'loop_output_projection_unavailable', captureOptions); }
        catch { captured = undefined; }
        if (output.safeParse(captured).success) return captured;
        if (method !== 'openOutputDirectory') throw Error('loop_output_projection_unavailable');
        // mkdir/OS navigation may already have happened. Never retry or mint an id.
        const unknown = { ok: false, loopId: input[0], error: 'open_output_directory_unknown' };
        output.parse(unknown); return unknown;
      },
    });
  }
}
