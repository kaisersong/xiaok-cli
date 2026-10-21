import { z } from 'zod';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import type { DesktopLoopPublicationService } from './loop-desktop-publication-service.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { executionIdentity } from './loop-verification-execution.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { LOOP_PUBLICATION_ACTION_SCHEMA, LOOP_PUBLICATION_ACTION_RESULT_SCHEMA, LOOP_PUBLICATION_STATE_SCHEMA,
  STORED_LOOP_PUBLICATION_CONFIGURATION_SCHEMA, type LoopPublicationActionDto } from '../shared/loop-publication-ipc-contract.js';

export const LOOP_PUBLICATION_CHANNELS = Object.freeze({
  getConfiguration: 'desktop:loops:getPublicationConfiguration', getState: 'desktop:loops:getPublicationState',
  perform: 'desktop:loops:performPublicationAction',
} as const);
type Method = keyof typeof LOOP_PUBLICATION_CHANNELS;
type Input = [string | LoopPublicationActionDto];
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const own = Object.hasOwn, isArray = Array.isArray;
const methods = new Map<string, Method>(Object.entries(LOOP_PUBLICATION_CHANNELS).map(([key, channel]) => [channel, key as Method]));
const owners = new WeakMap<IpcHandleRegistrar, Readonly<{
  service: DesktopLoopPublicationService; authorize: (event: unknown) => boolean; registrar: IpcHandleRegistrar;
}>>();
const outputs = { getConfiguration: STORED_LOOP_PUBLICATION_CONFIGURATION_SCHEMA.nullable(),
  getState: LOOP_PUBLICATION_STATE_SCHEMA, perform: LOOP_PUBLICATION_ACTION_RESULT_SCHEMA };
const mutationRisks: RiskTag[] = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'network',
  'external-process', 'exec', 'capability-token', 'issues-token', 'internal-mutation', 'dialog'];
function admission(ipc: IpcHandleRegistrar, service: DesktopLoopPublicationService,
  authorize: (event: unknown) => boolean): IpcHandleRegistrar {
  const old = owners.get(ipc);
  if (old) {
    if (old.service !== service || old.authorize !== authorize) throw Error('loop_publication_ipc_registrar_owner_conflict');
    return old.registrar;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    if (!methods.has(channel)) throw Error('loop_publication_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (!authorize(event)) throw Error('loop_publication_ipc_denied');
      if (args.length !== 1) throw Error('loop_publication_ipc_input');
      return listener(event, ...args);
    });
  } });
  owners.set(ipc, Object.freeze({ service, authorize, registrar }));
  return registrar;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const value = captureIpcData(raw, 'loop_publication_ipc_input', captureOptions);
    if (method !== 'perform') executionIdentity(value[0]);
    else {
      const action = value[0];
      if (!action || typeof action !== 'object' || isArray(action) || own(action, 'requestSource')
        || !LOOP_PUBLICATION_ACTION_SCHEMA.safeParse(action).success) throw Error('loop_publication_ipc_input');
    }
    return value;
  });
}
export function registerLoopPublicationIpc(ipc: IpcHandleRegistrar, service: DesktopLoopPublicationService,
  authorize: (event: unknown) => boolean): void {
  const registrar = admission(ipc, service, authorize);
  for (const [key, channel] of Object.entries(LOOP_PUBLICATION_CHANNELS)) {
    const method = key as Method, output = outputs[method];
    registerIpcHandler<Input, unknown>({ registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/loop-publication-typed-ipc.ts', rolloutRound: 9,
      riskTags: method === 'perform' ? [...mutationRisks] : ['fs-read'],
      handler: async input => {
        const action = input[0];
        const result = method === 'perform' ? await service.perform({ ...action as LoopPublicationActionDto, requestSource: 'user' })
          : method === 'getConfiguration' ? await service.getConfiguration(action as string) : await service.getState(action as string);
        const error = method === 'perform' ? 'loop_publication_operation_unknown' : 'loop_publication_projection_unavailable';
        let captured: unknown;
        try { captured = captureIpcData(result, error, captureOptions); }
        catch { throw Error(error); }
        if (!output.safeParse(captured).success) throw Error(error);
        if (method === 'perform' && (captured as { kind: string }).kind !== (action as LoopPublicationActionDto).kind) throw Error(error);
        return captured;
      },
    });
  }
}
