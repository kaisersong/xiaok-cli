import { z } from 'zod';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import type { LoopCurrentViews } from './loop-current-views.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { executionIdentity } from './loop-verification-execution.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { LOOP_CURRENT_VIEW_SCHEMAS } from '../shared/loop-current-view-ipc-contract.js';

export const LOOP_CURRENT_VIEW_CHANNELS = Object.freeze({
  listRuns: 'desktop:loops:listRuns', getRunHistory: 'desktop:automations:getRunHistory',
} as const);
type Method = keyof typeof LOOP_CURRENT_VIEW_CHANNELS;
type Input = [] | [string];
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const methods = new Map<string, Method>(Object.entries(LOOP_CURRENT_VIEW_CHANNELS)
  .map(([method, channel]) => [channel, method as Method]));
const owners = new WeakMap<IpcHandleRegistrar, Readonly<{
  service: LoopCurrentViews; authorize: (event: unknown) => boolean; registrar: IpcHandleRegistrar;
}>>();
// Actual completion preparation issues/consumes private read brands and may
// invoke TaskHost recovery and the installed controller's native readers.
const risks: RiskTag[] = ['fs-read', 'network', 'external-process', 'exec', 'capability-token',
  'issues-token', 'internal-mutation', 'fs-write-userData'];
function admission(ipc: IpcHandleRegistrar, service: LoopCurrentViews,
  authorize: (event: unknown) => boolean): IpcHandleRegistrar {
  const old = owners.get(ipc);
  if (old) {
    if (old.service !== service || old.authorize !== authorize) throw Error('loop_view_ipc_registrar_owner_conflict');
    return old.registrar;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    const method = methods.get(channel);
    if (!method) throw Error('loop_view_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (!authorize(event) || args.length !== (method === 'listRuns' ? 1 : 0)) throw Error('loop_view_ipc_denied');
      return listener(event, ...args);
    });
  } });
  owners.set(ipc, Object.freeze({ service, authorize, registrar }));
  return registrar;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const value = captureIpcData(raw, 'loop_view_ipc_input', captureOptions);
    if (method === 'listRuns') executionIdentity(value[0]);
    return value;
  });
}
export function registerLoopCurrentViewIpc(ipc: IpcHandleRegistrar, service: LoopCurrentViews,
  authorize: (event: unknown) => boolean): void {
  const registrar = admission(ipc, service, authorize);
  for (const [key, channel] of Object.entries(LOOP_CURRENT_VIEW_CHANNELS)) {
    const method = key as Method, output = LOOP_CURRENT_VIEW_SCHEMAS[method];
    registerIpcHandler<Input, unknown>({ registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/loop-current-view-ipc.ts', rolloutRound: 8, riskTags: [...risks],
      handler: async input => {
        const result = method === 'listRuns' ? await service.getLoopRuns(input[0]) : await service.getRunHistory();
        let captured: unknown;
        try { captured = captureIpcData(result, 'loop_view_projection_unavailable', captureOptions); }
        catch { throw Error('loop_view_projection_unavailable'); }
        if (!output.safeParse(captured).success) throw Error('loop_view_projection_unavailable');
        return captured;
      },
    });
  }
}
