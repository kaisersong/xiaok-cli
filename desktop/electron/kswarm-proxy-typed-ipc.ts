import { z } from 'zod';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { PROXY_EMPTY_INPUT_SCHEMA, PROXY_FACT_SCHEMA, PROXY_HEALTH_RESULT_SCHEMA,
  PROXY_HTTP_INPUT_SCHEMA, PROXY_PATH_INPUT_SCHEMA, PROXY_STATUS_RESULT_SCHEMA,
  PROXY_STREAM_RESULT_SCHEMA, type ProxyWireInput } from '../shared/kswarm-proxy-ipc-contract.js';

export interface ProxyRegistrationContext {
  bridge: object;
  service: object | null;
  workspace?: { authorize(event: unknown): boolean };
  eligible(method: string, path: unknown): boolean;
  isDispatch(path: string): boolean;
  execute(method: string, event: unknown, args: ProxyWireInput): Promise<unknown> | unknown;
}
const methods = ['get', 'getText', 'post', 'postJson', 'put', 'patch', 'delete', 'subscribe', 'unsubscribe', 'status', 'healthz', 'health'] as const;
type Method = typeof methods[number];
const channel = (method: Method) => method === 'health' || method === 'healthz' ? `desktop:connection:${method}`
  : ['subscribe', 'unsubscribe', 'status'].includes(method) ? `desktop:kswarm:stream:${method}` : `desktop:kswarm:proxy:${method}`;
const byChannel = new Map(methods.map(method => [channel(method), method]));
const http = new Set<Method>(['get', 'getText', 'post', 'postJson', 'put', 'patch', 'delete']);
const failure = (method: Method): unknown => method === 'delete' ? false
  : http.has(method) ? null : method === 'status' ? { status: 'disconnected', code: 'proxy_operation_unknown' }
    : { ok: false, ...(['subscribe', 'unsubscribe'].includes(method) ? { code: 'proxy_operation_unknown' } : {}) };
type Owner = Readonly<{ context: ProxyRegistrationContext; authorize: ((event: unknown) => boolean) | undefined;
  registrar: IpcHandleRegistrar; installed: Set<Method> }>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
function ownerFor(ipc: IpcHandleRegistrar, context: ProxyRegistrationContext): Owner {
  const prior = owners.get(ipc), authorize = context.workspace?.authorize;
  if (prior) {
    if (prior.context.bridge !== context.bridge || prior.context.service !== context.service
      || prior.context.workspace !== context.workspace || prior.authorize !== authorize)
      throw Error('kswarm_proxy_ipc_registrar_owner_conflict');
    return prior;
  }
  const fixed = Object.freeze({ ...context });
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(name: string, listener: IpcHandlerListener) {
    const method = byChannel.get(name);
    if (!method) throw Error('kswarm_proxy_ipc_channel');
    return ipc.handle(name, (event, ...args) => {
      if (http.has(method)) {
        if (!fixed.service || !fixed.eligible(method, args[0])) return failure(method);
        if (['post', 'postJson'].includes(method) && fixed.workspace && typeof args[0] === 'string'
          && fixed.isDispatch(args[0])) {
          let allowed = false;
          try { allowed = authorize?.call(fixed.workspace, event) === true; } catch { /* default deny */ }
          if (!allowed) return { ok: false, code: 'workspace_ipc_forbidden', ...(method === 'postJson' ? { status: 409 } : {}) };
        }
      }
      const length = ['subscribe', 'unsubscribe', 'status'].includes(method) ? 0 : 1;
      const write = ['post', 'postJson', 'put', 'patch'].includes(method);
      if (write ? args.length !== 1 && args.length !== 2 : args.length !== length) return failure(method);
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ context: fixed, authorize, registrar, installed: new Set<Method>() });
  owners.set(ipc, owner); return owner;
}
const networkService: RiskTag[] = ['network', 'exec', 'external-process', 'fs-read', 'fs-write', 'fs-write-userData', 'internal-mutation'];
export function registerKSwarmProxyTypedIpc(ipc: IpcHandleRegistrar, context: ProxyRegistrationContext): void {
  const owner = ownerFor(ipc, context);
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const schema = ['subscribe', 'unsubscribe', 'status'].includes(method) ? PROXY_EMPTY_INPUT_SCHEMA
      : ['post', 'postJson', 'put', 'patch'].includes(method) ? PROXY_HTTP_INPUT_SCHEMA : PROXY_PATH_INPUT_SCHEMA;
    const input = z.custom<ProxyWireInput>(() => true).transform(raw => {
      const captured = captureIpcData(raw, 'proxy_input_invalid');
      if (!schema.safeParse(captured).success) throw Error('proxy_input_invalid');
      return captured;
    });
    const output = method === 'status' ? PROXY_STATUS_RESULT_SCHEMA
      : ['subscribe', 'unsubscribe'].includes(method) ? PROXY_STREAM_RESULT_SCHEMA
        : ['health', 'healthz'].includes(method) ? PROXY_HEALTH_RESULT_SCHEMA
          : method === 'delete' ? z.boolean() : method === 'getText' ? z.string().nullable() : PROXY_FACT_SCHEMA;
    registerIpcHandler<ProxyWireInput, unknown>({ registrar: owner.registrar, channel: channel(method),
      payloadMode: 'tuple', input, output, sourceFile: 'desktop/electron/kswarm-proxy-typed-ipc.ts', rolloutRound: 16,
      riskTags: http.has(method) ? [...networkService]
        : ['subscribe', 'unsubscribe'].includes(method) ? ['long-subscription', 'internal-mutation', 'network']
          : method === 'status' ? [] : ['network'],
      inputError: () => failure(method), outputError: () => failure(method),
      handler: async (args, event) => owner.context.execute(method, event, args),
      captureOutput: result => {
        try { return captureIpcData(result, 'proxy_operation_unknown'); } catch { return failure(method); }
      },
    });
    owner.installed.add(method);
  }
}
