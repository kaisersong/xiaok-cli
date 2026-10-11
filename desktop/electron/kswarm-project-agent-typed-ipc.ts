import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { z } from 'zod';
import { types } from 'node:util';
import { KSWARM_ENTITY_INPUT_SCHEMAS, KSWARM_ENTITY_OUTPUT_SCHEMAS } from '../shared/kswarm-project-agent-ipc-contract.js';
import type { KSwarmSemanticService } from './kswarm-semantic-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';

const isPromise = types.isPromise, promiseThen = Promise.prototype.then, apply = Reflect.apply;
const channels = Object.freeze({
  projectCreate: 'desktop:kswarm:project:create', projectMode: 'desktop:kswarm:project:updateExecutionMode',
  projectDelete: 'desktop:kswarm:project:delete', agentCreate: 'desktop:kswarm:agent:create',
  agentUpdate: 'desktop:kswarm:agent:update', agentArchive: 'desktop:kswarm:agent:archive',
  agentStart: 'desktop:kswarm:agent:start', agentStop: 'desktop:kswarm:agent:stop', agentProbe: 'desktop:kswarm:agent:probe',
});
type Method = keyof typeof channels;
type Input = [Record<string, unknown>];
type Owner = Readonly<{ service: KSwarmSemanticService; registrar: IpcHandleRegistrar; installed: Set<Method> }>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
const methods = new Map<string, Method>(Object.entries(channels).map(([method, channel]) => [channel, method as Method]));
const common: RiskTag[] = ['network', 'fs-read', 'fs-write-userData', 'internal-mutation', 'capability-token'];
const processEffects: RiskTag[] = [...common, 'exec', 'external-process'];
const risks: Record<Method, RiskTag[]> = {
  projectCreate: [...processEffects, 'fs-write'], projectMode: [...common], projectDelete: [...common, 'fs-delete'],
  agentCreate: [...processEffects, 'fs-write'], agentUpdate: [...processEffects, 'fs-write'],
  agentArchive: [...common, 'fs-delete'], agentStart: [...processEffects], agentStop: [...processEffects], agentProbe: [...processEffects],
};
const forbidden = Object.freeze(['apiKey', 'baseUrl', 'provider', 'model', 'customEnv', 'runtimePath', 'execution', 'credential', 'secret']);
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('id_required');
  return value.trim();
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('object_required');
  return value as Record<string, unknown>;
}
function slot(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}
function assertAgentFields(value: Record<string, unknown>): void {
  if (forbidden.some(key => Object.hasOwn(value, key))) throw Error('agent_payload_forbidden');
}
function mode(value: unknown): 'direct' | 'auto' | 'workflow_preferred' {
  if (value === 'direct' || value === 'auto' || value === 'workflow_preferred') return value;
  throw Error('invalid_execution_mode');
}
function admission(ipc: IpcHandleRegistrar, service: KSwarmSemanticService): Owner {
  const old = owners.get(ipc);
  if (old) { if (old.service !== service) throw Error('kswarm_semantic_ipc_registrar_owner_conflict'); return old; }
  // Existing backend mutation credential/user/model gates are unchanged.
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    if (!methods.has(channel)) throw Error('kswarm_semantic_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (args.length !== 1) throw Error('kswarm_semantic_ipc_input');
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ service, registrar, installed: new Set<Method>() }); owners.set(ipc, owner); return owner;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const captured = captureIpcData(raw, 'kswarm_semantic_ipc_input'), value = captured[0];
    if (method === 'projectCreate') record(value);
    else if (method === 'agentCreate') assertAgentFields(record(value));
    else if (method === 'agentUpdate') { id(slot(value, 'agentId')); assertAgentFields(record(slot(value, 'patch'))); }
    else if (method === 'projectMode') { id(slot(value, 'projectId')); mode(slot(value, 'executionMode')); }
    else id(slot(value, method === 'projectDelete' ? 'projectId' : 'agentId'));
    if (!KSWARM_ENTITY_INPUT_SCHEMAS[method].safeParse(captured).success) throw Error('kswarm_semantic_ipc_input');
    return captured;
  });
}
export function registerKSwarmProjectAgentTypedIpc(ipc: IpcHandleRegistrar, service: KSwarmSemanticService): void {
  const owner = admission(ipc, service);
  for (const [key, channel] of Object.entries(channels)) {
    const method = key as Method, output = KSWARM_ENTITY_OUTPUT_SCHEMAS[method];
    if (owner.installed.has(method)) continue;
    registerIpcHandler<Input, unknown>({ registrar: owner.registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/kswarm-project-agent-typed-ipc.ts', rolloutRound: 12, riskTags: [...risks[method]],
      handler: async input => {
        const value = input[0]; let result: unknown;
        switch (method) {
          case 'projectCreate': result = service.createKSwarmProject(value); break;
          case 'projectMode': result = service.updateKSwarmProjectExecutionMode({ projectId: id(value.projectId), executionMode: mode(value.executionMode) }); break;
          case 'projectDelete': result = service.deleteKSwarmProject({ projectId: id(value.projectId) }); break;
          case 'agentCreate': result = service.createKSwarmAgent(value, { requestSource: 'user' }); break;
          case 'agentUpdate': result = service.updateKSwarmAgent({ id: id(value.agentId), changes: record(value.patch) }, { requestSource: 'user' }); break;
          case 'agentArchive': result = service.archiveKSwarmAgent({ id: id(value.agentId) }); break;
          case 'agentStart': result = service.startKSwarmAgent({ id: id(value.agentId) }); break;
          case 'agentStop': result = service.stopKSwarmAgent({ id: id(value.agentId) }); break;
          case 'agentProbe': result = service.probeKSwarmAgent({ id: id(value.agentId) }); break;
        }
        const snapshot = (value: unknown): unknown => {
          let captured: unknown;
          try { captured = captureIpcData(value, 'kswarm_semantic_operation_unknown'); }
          catch { throw Error('kswarm_semantic_operation_unknown'); }
          if (!output.safeParse(captured).success) throw Error('kswarm_semantic_operation_unknown');
          return captured;
        };
        if (isPromise(result)) {
          assertStandardIpcPromise(result, 'kswarm_semantic_operation_unknown');
          return apply(promiseThen, result, [snapshot]);
        }
        return snapshot(result);
      },
    });
    owner.installed.add(method);
  }
}
