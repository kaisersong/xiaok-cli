import {randomUUID} from 'node:crypto';
import type {IpcMainInvokeEvent} from 'electron';
import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler, type IpcRegistrationOptions } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { PROJECT_PLANNING_INPUT, PROJECT_PLANNING_OUTPUT } from '../shared/project-planning-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());
export interface ProjectPlanningTriggerProof {readonly opaqueProjectPlanningTrigger:never}
const triggers=new WeakMap<object,{owner:object;actorId:string;projectId:string;triggerRef:string;current:()=>void}>();
/** Original live Main gesture provenance only, never a B/model permission. */
export function inspectProjectPlanningTrigger(proof:ProjectPlanningTriggerProof,expectedOwner:object){
  const entry=triggers.get(proof);if(!entry||entry.owner!==expectedOwner)throw Error('project_planning_trigger_unverified');entry.current();
  return Object.freeze({actorId:entry.actorId,projectId:entry.projectId,triggerRef:entry.triggerRef});
}
interface PlanningAdmission extends Pick<IpcRegistrationOptions<unknown[],unknown>, 'beforeInput'|'beforeOutput'> {
  nativeTrigger?:{owner:object;authorize:(event:IpcMainInvokeEvent)=>{actorId:string}|null};
}
export function registerProjectPlanningIpc(ipc: IpcHandleRegistrar, producer: IpcHandlerListener, admission: PlanningAdmission = {}): void {
  const {nativeTrigger,...ipcAdmission}=admission;
  const readNativeActor=(event:IpcMainInvokeEvent):string=>{
    if(!nativeTrigger||types.isAsyncFunction(nativeTrigger.authorize))throw Error('project_planning_trigger_unverified');
    const raw=nativeTrigger.authorize(event);
    if(types.isPromise(raw)){apply(nativeThen,raw,[()=>undefined,()=>undefined]);throw Error('project_planning_trigger_unverified');}
    const actor=captureIpcData(raw,'project_planning_trigger_unverified');
    if(!actor||typeof actor.actorId!=='string'||!actor.actorId)throw Error('project_planning_trigger_unverified');return actor.actorId;
  };
  const capture = (raw: unknown) => {
    const snapshot = captureIpcData(raw, 'project_planning_projection_unavailable');
    if (!PROJECT_PLANNING_OUTPUT.safeParse(snapshot).success) throw Error('project_planning_projection_unavailable');
    return snapshot;
  };
  registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel: 'desktop:kswarm:startProjectPlanning',
    payloadMode: 'tuple', rolloutRound: 37, riskTags: ['fs-write', 'network'], sourceFile: 'desktop/electron/project-planning-typed-ipc.ts',
    ...ipcAdmission,
    input: z.custom<unknown[]>(() => true).transform(raw => {
      const snapshot = captureIpcData(raw, 'project_planning_input_invalid');
      if (!z.tuple([PROJECT_PLANNING_INPUT]).safeParse(snapshot).success) throw Error('project_planning_input_invalid');
      return snapshot as unknown[];
    }), output: PROJECT_PLANNING_OUTPUT,
    handler: async (args, event) => {
      assertStandardIpcPromise(witness, 'project_planning_projection_unavailable');
      let active=true,proof:ProjectPlanningTriggerProof|undefined;
      if(nativeTrigger){
        const actorId=readNativeActor(event);
        proof=Object.freeze(Object.create(null)) as ProjectPlanningTriggerProof;
        triggers.set(proof,{owner:nativeTrigger.owner,actorId,projectId:(args[0] as {projectId:string}).projectId,triggerRef:'main-explicit-planning:'+randomUUID(),current(){
          if(!active)throw Error('project_planning_trigger_unverified');const next=readNativeActor(event);if(next!==actorId)throw Error('task_actor_forbidden');
        }});
      }
      const release=()=>{active=false;if(proof)triggers.delete(proof);};
      try{
        const result = producer(event, ...args,...(proof?[proof]:[]));
        if (!types.isPromise(result)){try{return capture(result);}finally{release();}}
        assertStandardIpcPromise(result, 'project_planning_projection_unavailable');
        return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(capture(value)); } catch (failure) { reject(failure); }finally{release();}
        }, (failure:unknown)=>{release();reject(failure);} ]));
      }catch(error){release();throw error;}
    }, captureOutput: capture,
  });
}
