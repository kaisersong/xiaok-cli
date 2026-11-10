import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {FileTaskSnapshotStore} from './snapshot-store.js';
import type {MaterialRegistry} from './material-registry.js';
import type {TaskCreateInput,TaskSnapshot} from './types.js';
import {createRoomTurnCustody} from '../verification/original-sdk-custody.js';
import {createContinuityCallbackCustody} from './continuity-callback-custody.js';
export interface PendingTaskInputIdentity{taskId:string;sessionId:string;revision:string}
export interface ContinuityInputReservation{readonly taskId:string;readonly reservationId:string;readonly sessionId?:string}
export interface ContinuityInputSourceOptions{
 readPendingInputIdentity?:(id:string)=>PendingTaskInputIdentity|null;
 authorizeInputPreparation?:(id:string,identity:PendingTaskInputIdentity,input:TaskCreateInput)=>void;
 authorizeInputAdmission?:(snapshot:TaskSnapshot)=>void;
}
interface Origin{inputId:string;identity:PendingTaskInputIdentity;digest?:string;attempt?:{failed:boolean;settled:boolean;writeEntered:boolean;consumed:boolean}}
const apply=Reflect.apply;
const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** Private per-Host journal bridge. This source conveys no Native/role authority. */
export class ContinuityInputSource{
 readonly #origins=new WeakMap<object,Origin>();readonly #restoring=new Map<string,Promise<ContinuityInputReservation>>();
 readonly #stocks:ReturnType<typeof createRoomTurnCustody>[]=[];readonly #callbacks=createContinuityCallbackCustody();
 readonly #inspect:typeof FileTaskSnapshotStore.prototype.inspectPersistedTask;
 readonly #read?:Function;readonly #prepare?:Function;readonly #admit?:Function;
 constructor(private readonly options:ContinuityInputSourceOptions,private readonly store:FileTaskSnapshotStore,private readonly materials:MaterialRegistry,
 private readonly current:()=>void,private readonly reserve:(taskId:string,sessionId:string)=>ContinuityInputReservation,private readonly valid:(r:ContinuityInputReservation)=>boolean,private readonly occupied:(id:string)=>boolean,private readonly invoke:(fn:Function,args:unknown[])=>unknown){
  this.#inspect=FileTaskSnapshotStore.prototype.inspectPersistedTask;
  for(const [key,slot] of [['readPendingInputIdentity','read'],['authorizeInputPreparation','prepare'],['authorizeInputAdmission','admit']] as const){const d=Object.getOwnPropertyDescriptor(options,key);if(d&&!Object.hasOwn(d,'value'))throw Error('input_owner_callback_invalid');if(d?.value!==undefined&&(typeof d.value!=='function'||types.isProxy(d.value)))throw Error('input_owner_callback_invalid');if(d?.value){this.#callbacks.capture(d.value);if(slot==='read')this.#read=d.value;else if(slot==='prepare')this.#prepare=d.value;else this.#admit=d.value;}}
 }
 private call<T>(fn:Function,args:unknown[]):T{this.current();this.#callbacks.capture(fn);const stock=createRoomTurnCustody();this.#stocks.push(stock);let value!:T,first:{raw:unknown}|undefined;try{stock.syncVoid(()=>{value=this.invoke(fn,args) as T;},undefined,[]);stock.inventory(value);stock.assertPhysicalKnown();}catch(raw){first={raw};}try{this.#callbacks.capture(fn);}catch(raw){if(first)throw new AggregateError([first.raw,raw],"input_callback_unknown",{cause:first.raw});throw raw;}if(first)throw first.raw;return value;}
 private async inspect(id:string):Promise<TaskSnapshot|null>{this.current();this.#callbacks.capture(this.#inspect);const stock=createRoomTurnCustody();this.#stocks.push(stock);let value:TaskSnapshot|null=null,first:{raw:unknown}|undefined;try{value=await stock.sdk<TaskSnapshot|null>(this.#inspect,this.store,[id]);}catch(raw){first={raw};}try{this.#callbacks.capture(this.#inspect);}catch(raw){if(first)throw new AggregateError([first.raw,raw],"input_inspection_unconfirmed",{cause:first.raw});throw raw;}if(first)throw first.raw;return value;}
 private read(id:string):PendingTaskInputIdentity{
  if(typeof id!=='string'||!id||id.length>256||!this.#read)throw Error('input_identity_unavailable');const raw=this.call<unknown>(this.#read,[id]);
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||Reflect.ownKeys(raw).sort().join(',')!=='revision,sessionId,taskId')throw Error('input_identity_unavailable');
  const result={} as PendingTaskInputIdentity;for(const key of ['taskId','sessionId','revision'] as const){const d=Object.getOwnPropertyDescriptor(raw,key);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.value||d.value.length>256||/[\u0000-\u001f]/u.test(d.value))throw Error('input_identity_unavailable');result[key]=d.value;}
  if(!/^[A-Za-z0-9_-]+$/.test(result.taskId))throw Error('input_identity_unavailable');return Object.freeze(result);
 }
 assertDependencies(store:FileTaskSnapshotStore,materials:MaterialRegistry){this.current();if(this.store!==store||this.materials!==materials)throw Error('input_owner_dependency_mismatch');}
 async bind(id:string,reservation:ContinuityInputReservation){this.current();if(!this.valid(reservation)||this.#origins.has(reservation))throw Error('input_identity_conflict');const first=this.read(id);if(first.taskId!==reservation.taskId||first.sessionId!==reservation.sessionId)throw Error('input_identity_conflict');if(await this.inspect(first.taskId))throw Error('input_identity_conflict');this.current();const last=this.read(id);if(hash(first)!==hash(last)||!this.valid(reservation)||this.occupied(first.taskId))throw Error('input_identity_conflict');this.#origins.set(reservation,{inputId:id,identity:first});}
 restore(id:string):Promise<ContinuityInputReservation>{const previous=this.#restoring.get(id);if(previous)return previous;const pending=(async()=>{const first=this.read(id);if(await this.inspect(first.taskId))throw Error('input_identity_conflict');this.current();const last=this.read(id);if(hash(first)!==hash(last)||this.occupied(first.taskId))throw Error('input_identity_conflict');const reservation=this.reserve(first.taskId,first.sessionId);this.#origins.set(reservation,{inputId:id,identity:first});return reservation;})();this.#restoring.set(id,pending);void pending.catch(()=>{if(this.#restoring.get(id)===pending)this.#restoring.delete(id);});return pending;}
 begin(reservation:ContinuityInputReservation|undefined,input:TaskCreateInput){const origin=reservation&&this.#origins.get(reservation);if(!origin)return;if(origin.attempt)throw Error('input_identity_conflict');origin.digest=hash(input);origin.attempt={failed:false,settled:false,writeEntered:false,consumed:false};this.assertPreparation(reservation,input);}
 assertPreparation(reservation:ContinuityInputReservation|undefined,input:TaskCreateInput){const origin=reservation&&this.#origins.get(reservation);if(!origin)return;this.current();if(!this.#prepare||origin.digest!==hash(input)||hash(origin.identity)!==hash(this.read(origin.inputId)))throw Error('input_authority_changed');const result=this.call<unknown>(this.#prepare,[origin.inputId,origin.identity,input]);if(result!==undefined)throw Error('input_preparation_unavailable');}
 marker(reservation:ContinuityInputReservation|undefined){const origin=reservation&&this.#origins.get(reservation);return origin?{inputId:origin.inputId,inputRevision:origin.identity.revision}:undefined;}
 writeEntered(reservation:ContinuityInputReservation|undefined){const attempt=reservation&&this.#origins.get(reservation)?.attempt;if(attempt)attempt.writeEntered=true;}
 finish(reservation:ContinuityInputReservation|undefined,failed:boolean){const origin=reservation&&this.#origins.get(reservation);if(origin?.attempt){origin.attempt.failed=failed;origin.attempt.settled=true;this.#restoring.delete(origin.inputId);}}
 admit(snapshot:TaskSnapshot){if(!this.#admit){if(snapshot.inputPreparation)throw Error('input_admission_unavailable');return;}const result=this.call<unknown>(this.#admit,[snapshot]);if(result!==undefined)throw Error('input_admission_unavailable');}
 consumeFailed(id:string,r:ContinuityInputReservation,revision:string,digest:string){const origin=this.#origins.get(r),attempt=origin?.attempt;this.current();if(!origin||!attempt||origin.inputId!==id||origin.identity.revision!==revision||origin.identity.taskId!==r.taskId||origin.identity.sessionId!==r.sessionId||origin.digest!==digest||!attempt.failed||!attempt.settled||attempt.writeEntered||attempt.consumed||this.valid(r)||this.occupied(r.taskId))throw Error('input_never_started_proof_unavailable');this.assertKnown();attempt.consumed=true;}
 async waitKnown(){const errors:unknown[]=[];for(const stock of this.#stocks)try{await stock.waitPhysicalKnown();}catch(raw){errors.push(raw);}try{await this.#callbacks.waitPhysicalKnown();}catch(raw){errors.push(raw);}if(errors.length)throw new AggregateError(errors,'input_owner_sdk_unknown',{cause:errors[0]});this.assertKnown();}
 assertKnown(){this.#callbacks.assertPhysicalKnown();for(const stock of this.#stocks)stock.assertPhysicalKnown();}
}
