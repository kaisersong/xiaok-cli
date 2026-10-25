import { z } from 'zod';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { types } from 'node:util';
import type { createDesktopServices } from './desktop-services.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { DIAGNOSTICS_IPC_CHANNELS, DIAGNOSTICS_INPUT_QUALIFICATION, DIAGNOSTICS_INPUT_SCHEMAS, DIAGNOSTICS_OUTPUT_SCHEMAS, type DesktopDiagnosticsMethod } from '../shared/desktop-diagnostics-ipc-contract.js';
type Service = Pick<ReturnType<typeof createDesktopServices>, DesktopDiagnosticsMethod>;
const methods = Object.keys(DIAGNOSTICS_IPC_CHANNELS) as DesktopDiagnosticsMethod[];
const isPromise = types.isPromise, apply = Reflect.apply;
const nativeThen = Promise.prototype.then;
const owners = new WeakMap<IpcHandleRegistrar, { service: Service | null; registrar: IpcHandleRegistrar; installed: Set<DesktopDiagnosticsMethod> }>();
const risks: Record<DesktopDiagnosticsMethod, RiskTag[]> = { getSkillStats: ['fs-read'], exportTraceBundle: ['fs-read','fs-write','fs-write-userData','network'], diagnose: ['fs-read','network'] };
function log(message: string, fields: unknown): void { console.log(`[${new Date().toISOString()}] [info] [ipc] ${message} ${JSON.stringify(fields)}`); }
function fields(raw: unknown): { kind?: unknown; id?: unknown } {
  return raw && typeof raw === 'object' ? {kind:Object.getOwnPropertyDescriptor(raw,'kind')?.value,id:Object.getOwnPropertyDescriptor(raw,'id')?.value} : {};
}
/** Producer routing and business error/output semantics remain unchanged. */
function invokeLegacy(service: Service, method: 'exportTraceBundle'|'diagnose', input: unknown): unknown {
  return apply(service[method], service, method === 'exportTraceBundle' ? [input, 'user'] : [input]);
}

export function registerDiagnosticsIpc(ipc: IpcHandleRegistrar, rawService?: Service): void {
  const service = rawService ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.service !== service) throw Error('diagnostics_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => { if (!service) throw Error('diagnostics_runtime_unavailable'); return listener(event, ...args); });
    } });
    owner = {service,registrar,installed:new Set()};owners.set(ipc,owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const error = method === 'exportTraceBundle' ? 'diagnostics_export_operation_unknown' : 'diagnostics_projection_unavailable';
    const capture = (value: unknown): unknown => {
      const snapshot = captureIpcData(value,error,{preserveDataPrototype:true});
      if (!DIAGNOSTICS_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
      if (method === 'exportTraceBundle') {const result=snapshot as {ok:boolean;path?:string};log('traceExport result',{ok:result.ok,path:result.path});}
      if (method === 'diagnose') {const result=snapshot as {health:string;primaryFinding:{category:string}|null};log('diagnose result',{health:result.health,primaryFinding:result.primaryFinding?.category??null});}
      return snapshot;
    };
    const registration = {registrar:owner.registrar,channel:DIAGNOSTICS_IPC_CHANNELS[method],
      input: method === 'getSkillStats' ? z.custom<unknown>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'diagnostics_input_invalid');
        if (!DIAGNOSTICS_INPUT_SCHEMAS.getSkillStats.safeParse(snapshot).success) throw Error('diagnostics_input_invalid');
        return snapshot;
      }).describe(DIAGNOSTICS_INPUT_QUALIFICATION.getSkillStats) : z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'diagnostics_input_invalid', { preserveDataPrototype: true });
        if (!DIAGNOSTICS_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('diagnostics_input_invalid');
        return snapshot as unknown[];
      }).describe(DIAGNOSTICS_INPUT_QUALIFICATION[method]),
      output:DIAGNOSTICS_OUTPUT_SCHEMAS[method],sourceFile:'desktop/electron/diagnostics-typed-ipc.ts',rolloutRound:(method === 'getSkillStats' ? 19 : 35) as 19 | 35,riskTags:risks[method],
      handler: async (raw: unknown) => {
        if (!service) throw Error('diagnostics_runtime_unavailable');
        const input = method === 'getSkillStats' ? undefined : (raw as unknown[])[0];
        if (method !== 'getSkillStats') log(method==='diagnose'?'diagnose':'traceExport',fields(input));
        let result: unknown;
        try {result=method==='getSkillStats'?service.getSkillStats():invokeLegacy(service,method,input);}
        catch (failure) {throw failure;}
        if (!isPromise(result)) return capture(result);
        assertStandardIpcPromise(result,error);
        return new Promise((resolve,reject)=>{
          apply(nativeThen,result,[(value:unknown)=>{try{resolve(capture(value));}catch(failure){reject(failure);}},
            (failure:unknown)=>reject(failure)]);
        });
      },
    };
    if (method === 'getSkillStats') registerIpcHandler<unknown[], unknown>({ ...registration, input: registration.input as import('zod').ZodSchema<unknown[]>, payloadMode: 'tuple' });
    else registerIpcHandler<unknown[], unknown>({ ...registration, input: registration.input as import('zod').ZodSchema<unknown[]>, payloadMode: 'tuple' });
    owner.installed.add(method);
  }
}
