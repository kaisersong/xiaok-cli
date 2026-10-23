import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { z } from 'zod';
import { types } from 'node:util';
import { KSWARM_TEAM_INPUT_SCHEMAS, KSWARM_TEAM_OUTPUT_SCHEMAS } from '../shared/kswarm-team-ipc-contract.js';
import type { KSwarmSemanticService } from './kswarm-semantic-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';

const isPromise = types.isPromise, promiseThen = Promise.prototype.then, apply = Reflect.apply;
const channels = Object.freeze({ plan: 'desktop:kswarm:team:plan', apply: 'desktop:kswarm:team:apply', getOperation: 'desktop:kswarm:team:getOperation' });
type Method = keyof typeof channels;
type Input = [{ projectId: string; planId?: string; projectRevision?: number }];
type Owner = Readonly<{ service: KSwarmSemanticService; registrar: IpcHandleRegistrar; installed: Set<Method> }>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
const methods = new Map<string, Method>(Object.entries(channels).map(([method, channel]) => [channel, method as Method]));
const risks: Record<Method, RiskTag[]> = {
  plan: ['network', 'fs-read', 'fs-write-userData', 'internal-mutation', 'capability-token'],
  apply: ['network', 'fs-read', 'fs-write', 'fs-write-userData', 'internal-mutation', 'capability-token'],
  getOperation: ['network', 'fs-read', 'fs-write', 'fs-write-userData', 'internal-mutation', 'capability-token'],
};
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('id_required');
  return value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('invalid_project_revision');
  return Number(value);
}
function slot(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, key)?.value : undefined;
}
function admission(ipc: IpcHandleRegistrar, service: KSwarmSemanticService): Owner {
  const prior = owners.get(ipc);
  if (prior) { if (prior.service !== service) throw Error('kswarm_team_ipc_registrar_owner_conflict'); return prior; }
  // Preserve the existing semantic admission: no new team authority is issued
  // here. Backend Desktop mutation credential/user/CAS gates remain owners.
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    if (!methods.has(channel)) throw Error('kswarm_team_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (args.length !== 1) throw Error('kswarm_team_ipc_input');
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ service, registrar, installed: new Set<Method>() }); owners.set(ipc, owner); return owner;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const captured = captureIpcData(raw, 'kswarm_team_ipc_input');
    const input = captured[0]; id(slot(input, 'projectId'));
    if (method === 'apply') { id(slot(input, 'planId')); revision(slot(input, 'projectRevision')); }
    if (!KSWARM_TEAM_INPUT_SCHEMAS[method].safeParse(captured).success) throw Error('kswarm_team_ipc_input');
    return captured;
  });
}
export function registerKSwarmTeamTypedIpc(ipc: IpcHandleRegistrar, service: KSwarmSemanticService): void {
  const owner = admission(ipc, service);
  for (const [key, channel] of Object.entries(channels)) {
    const method = key as Method, output = KSWARM_TEAM_OUTPUT_SCHEMAS[method];
    if (owner.installed.has(method)) continue;
    registerIpcHandler<Input, unknown>({ registrar: owner.registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/kswarm-team-typed-ipc.ts', rolloutRound: 11, riskTags: [...risks[method]],
      handler: async input => {
        const value = input[0], projectId = id(value.projectId);
        const result = method === 'plan' ? service.planProjectTeam({ projectId })
          : method === 'getOperation' ? service.getProjectTeamOperation({ projectId })
          : service.applyProjectTeamPlan({ projectId, planId: id(value.planId), projectRevision: revision(value.projectRevision) });
        const snapshot = (result: unknown): unknown => {
          let captured: unknown;
          try { captured = captureIpcData(result, 'kswarm_team_operation_unknown'); }
          catch { throw Error('kswarm_team_operation_unknown'); }
          if (!output.safeParse(captured).success) throw Error('kswarm_team_operation_unknown');
          return captured;
        };
        if (isPromise(result)) {
          assertStandardIpcPromise(result, 'kswarm_team_operation_unknown');
          return apply(promiseThen, result, [snapshot]);
        }
        return snapshot(result);
      },
    });
    owner.installed.add(method);
  }
}
