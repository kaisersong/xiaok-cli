import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import { types } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NativeSnapshot, NativeSummary } from '../shared/codex-native-types.js';
import type { SessionProbe, NativeEvent } from './codex-native-transport.js';
import type { NativeActor, NativeServiceOptions, NativeTaskTurn, NativeApprovalInventory, Session } from './codex-native-support.js';
import type { CodexOrdinaryWriter } from './codex-ordinary-writer.js';
import { assertOriginalCodexNativeLifecycle } from './codex-native-service.js';

type State = {
  questionIncarnation:string;assertLiveQuestionTurn(session:Session):void;
  db: DatabaseSync; writer: CodexOrdinaryWriter; options: NativeServiceOptions;
  sessions: Map<string, Session>; notices: Map<string, ReturnType<typeof setTimeout>>;
  disposed: boolean; stopping: boolean; used: boolean;
  quiescence?: Promise<void>; disposal?: Promise<void>;
  advanceApprovalRevision(session:Session):void;save(session:Session):void;
  serial<T>(session:Session,fn:()=>Promise<T>):Promise<T>;flush(session:Session):Promise<void>;
  authorize(actor:NativeActor):void;connect(session:Session):Promise<void>;
  background(session:Session,work:()=>void):void;
  owned(actor: NativeActor, id: string): Session;
  writeCurrent(session?: Session): void; revoke(session: Session): void; cancelQueue(session: Session): void;
};
function state(owner: unknown): State {
  // Membership is checked before any property access (including foreign Proxy).
  assertOriginalCodexNativeLifecycle(owner);
  return owner as State;
}
function retainFailure(s: State, raw: unknown): void { s.writer.fail(raw); }
function projection(owner: unknown, session: Session): void {
  const s=state(owner);
  try { saveNativeProjection(owner,session); }
  catch(raw) { s.writer.hold(raw); if(!s.writer.isPolicy(raw))throw raw; }
}
const negativeStocks=new WeakMap<object,ReturnType<typeof createRoomTurnCustody>[]>();
const apply=Reflect.apply,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,push=Array.prototype.push,isProxy=types.isProxy;
const ownKeys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
async function negativeCall(owner:unknown,session:Session,client:SessionProbe,method:'close'|'interrupt'):Promise<void> {
  assertOriginalCodexNativeLifecycle(owner,session,client);const s=state(owner);
  const stock=createRoomTurnCustody(),stocks=apply(weakGet,negativeStocks,[owner]) as ReturnType<typeof createRoomTurnCustody>[]|undefined ??[];
  apply(weakSet,negativeStocks,[owner,stocks]);apply(push,stocks,[stock]);
  // Strong operation row precedes reading the actual SDK function or calling it.
  let fn:Function;
  try{fn=client[method];if(typeof fn!=='function'||isProxy(fn))throw Error('CODEX_CLEANUP_FUNCTION_UNCONFIRMED');}
  catch(raw){s.writer.fail(raw);throw raw;}
  const metadata:unknown[]=[];
  const capture=()=>{for(const key of ownKeys(fn)){const d=descriptor(fn,key);if(!d||!own(d,'value'))apply(push,metadata,[fn]);else apply(push,metadata,[d.value]);}};
  try{capture();}catch(raw){apply(push,metadata,[raw,fn]);}
  // This new operation has independent custody so another unknown operation
  // cannot prevent attempt-all negative SDK calls on the other owned clients.
  const pending=stock.sdk<void>(fn,client,[]);
  try{capture();}catch(raw){apply(push,metadata,[raw,fn]);}
  for(let i=0;i<metadata.length;i++)stock.inventory(metadata[i]);
  try{await pending;}catch(raw){s.writer.fail(raw);throw raw;}
}
async function closeClient(owner:unknown,session:Session,client:SessionProbe):Promise<void> {await negativeCall(owner,session,client,'close');}
/** Fixed projection consumer: no caller verifier, SQL or callback is accepted. */
export function saveNativeProjection(owner: unknown, session: Session): void {
  assertOriginalCodexNativeLifecycle(owner,session);
  const s=state(owner);s.writeCurrent(session);
  session.view.updatedAt=Date.now();session.view.revision++;
  session.view.approvals=[...session.pending.values()].map(p=>p.view);session.view.queued=session.queue.length;
  session.view.messages=session.view.messages.slice(-200);
  for(const m of session.view.messages)m.text=m.text.slice(-65536);
  const snapshot=JSON.stringify({...session.view,approvals:[]}),id=session.view.id,profileId=s.options.profileId,nativeId=session.nativeId;
  // DTO/stringification may reenter. No statement is prepared until this check.
  s.writeCurrent(session);
  const statement=s.db.prepare('INSERT OR REPLACE INTO codex_native_sessions (id,owner,native_id,snapshot) VALUES (?,?,?,?)');
  s.writeCurrent(session);statement.run(id,profileId,nativeId,snapshot);
  if(!s.notices.has(session.view.id))s.notices.set(session.view.id,setTimeout(()=>{
    s.notices.delete(session.view.id);
    try{s.writeCurrent(session);s.options.onChanged?.(session.view.id);}
    catch(raw){s.writer.hold(raw);if(!s.writer.isPolicy(raw))s.writer.fail(raw);}
  },80));
}
export function closeNativeBeforeUse(owner: unknown): void {
  const s=state(owner);if(s.used)throw Error('native_already_used');if(s.disposed)return;
  try{s.writer.stock.syncVoid(s.db.close,s.db,[]);s.disposed=true;s.writer.closed();}catch(raw){retainFailure(s,raw);throw raw;}
}
export async function interruptNative(owner: unknown, actor: NativeActor, id: string): Promise<void> {
  const s=state(owner),session=s.owned(actor,id);session.stopping=true;
  const failures:unknown[]=[];
  try{s.revoke(session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  try{s.cancelQueue(session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  try{
    await session.lock;
    if(session.client?.activeTurnId){assertOriginalCodexNativeLifecycle(owner,session,session.client);await negativeCall(owner,session,session.client,'interrupt');}
  }catch(raw){failures.push(raw);retainFailure(s,raw);}
  session.stopping=false;
  try{projection(owner,session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  if(failures.length)throw failures[0];
}
export async function disconnectNative(owner: unknown, actor: NativeActor, id: string): Promise<void> {
  const s=state(owner),session=s.owned(actor,id);session.stopping=true;
  const failures:unknown[]=[];
  try{s.revoke(session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  try{s.cancelQueue(session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  try{await session.lock;if(session.client)await closeClient(owner,session,session.client);session.client=undefined;session.view.status='disconnected';}
  catch(raw){failures.push(raw);retainFailure(s,raw);session.view.status='error';session.view.error='native_process_cleanup_unconfirmed';}
  session.stopping=false;
  try{projection(owner,session);}catch(raw){failures.push(raw);retainFailure(s,raw);}
  if(failures.length)throw failures[0];
}
export function beginNativeShutdown(owner: unknown): void {
  const s=state(owner);if(s.stopping)return;s.stopping=true;
  for(const timer of s.notices.values())clearTimeout(timer);s.notices.clear();
  for(const session of s.sessions.values()){
    session.stopping=true;
    try{s.revoke(session);}catch(raw){retainFailure(s,raw);}
    try{s.cancelQueue(session);}catch(raw){retainFailure(s,raw);}
  }
}
export function quiesceNativeShutdown(owner: unknown): Promise<void> {
  const s=state(owner);if(s.quiescence)return s.quiescence;
  // Publish the aggregate before any SDK or callback can reenter shutdown.
  s.quiescence=Promise.resolve().then(async()=>{
    const results=await Promise.allSettled([...s.sessions.values()].map(async session=>{
      const client=session.client;if(client)await closeClient(owner,session,client);
      await session.lock;
      if(session.client&&session.client!==client)await closeClient(owner,session,session.client);
      session.client=undefined;session.view.status='disconnected';projection(owner,session);
    }));
    const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);
    if(failures.length)throw new AggregateError(failures,'native_shutdown_unconfirmed');
    const stocks=apply(weakGet,negativeStocks,[owner]) as ReturnType<typeof createRoomTurnCustody>[]|undefined;
    if(stocks)for(let i=0;i<stocks.length;i++)await stocks[i]!.waitPhysicalKnown();
    await s.writer.waitKnown();
  });
  beginNativeShutdown(owner);return s.quiescence;
}
export function disposeNative(owner: unknown): Promise<void> {
  const s=state(owner);if(s.disposal)return s.disposal;
  s.disposal=Promise.resolve().then(async()=>{
    await quiesceNativeShutdown(owner);
    try{s.writer.stock.syncVoid(s.db.close,s.db,[]);s.disposed=true;s.writer.closed();}catch(raw){retainFailure(s,raw);throw raw;}
  });
  beginNativeShutdown(owner);return s.disposal;
}

/** Display/event handling only; task-turn proofs remain in the original Service. */
export function applyNativeEventProjection(owner:unknown,session:Session,e:NativeEvent):void {
  assertOriginalCodexNativeLifecycle(owner,session);const service=state(owner);service.writeCurrent(session);
    if(e.method==='serverRequest/resolved'){
      for(const [token,p] of session.pending)if(p.requestId===String(e.params?.requestId)){service.advanceApprovalRevision(session);clearTimeout(p.timer);session.pending.delete(token);p.resolve({decision:'decline'});}
      service.save(session);return;
    }
    if(e.method==='turn/completed'&&e.params.turn.id!==session.turnId)return;
    if(e.method==='item/started'&&e.params.item?.type==='fileChange')session.items.set(e.params.item.id,e.params.item);
    if(e.method==='item/agentMessage/delta') {
      session.ready=true;const id=String(e.params.itemId);let message=session.view.messages.find(m=>m.id===id);
      if(!message){message={id,role:'assistant',text:''};session.view.messages.push(message);}message.text+=String(e.params.delta ?? '');
      void service.serial(session,()=>service.flush(session)).catch(raw=>{service.writer.hold(raw);if(!service.writer.isPolicy(raw))service.writer.fail(raw);});
    }
    if(e.method==='item/completed'&&e.params.item?.type==='agentMessage') {
      const item=e.params.item;const old=session.view.messages.find(m=>m.id===item.id);if(old)old.text=item.text;else session.view.messages.push({id:item.id,role:'assistant',text:item.text});
    }
    if(e.method==='turn/completed') {
      session.liveTurn=false;
      service.revoke(session);session.ready=false;session.view.status=e.params.turn.status==='failed'?'error':'idle';
      if(session.view.status==='error')session.view.error='native_turn_failed';
      if(e.params.turn.status==='interrupted')service.cancelQueue(session);else void service.serial(session,()=>service.flush(session)).catch(raw=>{service.writer.hold(raw);if(!service.writer.isPolicy(raw))service.writer.fail(raw);});
    }
    if(['turn/started','turn/completed','item/agentMessage/delta','item/completed'].includes(e.method))service.save(session);
}

export function requestNativeApproval(owner:unknown,session:Session,client:SessionProbe,r:any):Promise<any> {
  assertOriginalCodexNativeLifecycle(owner,session,client);const service=state(owner);

    try{service.writeCurrent(session);}catch(raw){service.writer.hold(raw);return Promise.resolve({decision:'decline'});}
    const method=r.method;const decline={decision:'decline'};
    if(method==='item/permissions/requestApproval')return Promise.resolve({permissions:{},scope:'turn'});
    if(method==='mcpServer/elicitation/request')return Promise.resolve({action:'decline',content:null});
    if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return Promise.resolve(null);
    if(service.stopping||session.stopping||session.client!==client||r.params?.threadId!==session.nativeId||r.params?.turnId!==client.activeTurnId)return Promise.resolve(decline);
    if(method==='item/fileChange/requestApproval'&&!session.items.has(r.params.itemId))return Promise.resolve(decline);
    const token=randomUUID();
    const description=JSON.stringify({request:r.params,...(method==='item/fileChange/requestApproval'?{changes:session.items.get(r.params.itemId)}:{})},null,2);
    if(description.length>16000)return Promise.resolve(decline);
    return new Promise(resolve=>{
      const view={token,method,description:description.slice(0,16000),expiresAt:Date.now()+(service.options.approvalTimeoutMs??120000)};
      const timer=setTimeout(()=>{service.background(session,()=>{if(session.pending.has(token)){service.advanceApprovalRevision(session);session.pending.delete(token);}resolve(decline);service.writeCurrent(session);service.save(session);});},service.options.approvalTimeoutMs??120000);
      service.advanceApprovalRevision(session);session.pending.set(token,{view,connection:client,threadId:session.nativeId!,turnId:client.activeTurnId!,requestId:String(r.id),digest:createHash('sha256').update(JSON.stringify(r)).digest('hex'),resolve,timer});service.save(session);
    });
}

export async function sendNativeOwned(owner:unknown,actor:NativeActor,id:string,text:string,onTurnStarted?:(turn:NativeTaskTurn)=>void):Promise<void> {
  const service=state(owner);

    const s=service.owned(actor,id);service.writeCurrent(s);if(service.stopping)throw Error('native_stopping');if(typeof text!=='string'||!text.trim()||text.length>32000)throw new Error('native_invalid_message');
    return service.serial(s,async()=>{
      service.writeCurrent(s);if(s.stopping)throw new Error('native_stopping');await service.connect(s);
      service.authorize(actor);
      service.writeCurrent(s);if(service.stopping||s.stopping)throw Error('native_stopping');
      if(onTurnStarted && (s.client?.activeTurnId || s.queue.length))throw Error('native_task_turn_busy');
      const message={id:randomUUID(),role:'user' as const,text,state:'queued' as const};s.view.messages.push(message);
      if(s.view.title==='Codex')s.view.title=text.slice(0,60);
      s.queue.push({id:message.id,text});service.save(s);
      s.startingTaskTurn=onTurnStarted;
      try { await service.flush(s); } finally { if(s.startingTaskTurn===onTurnStarted)s.startingTaskTurn=undefined; }
    });
}

export function advanceNativeApprovalRevision(owner:unknown,session:Session):void {
  assertOriginalCodexNativeLifecycle(owner,session);
  const next=(session.approvalRevision??0)+1;
  if(!Number.isSafeInteger(next))throw Error('native_approval_inventory_revision_exhausted');
  session.approvalRevision=next;
}
export function cancelNativeQueue(owner:unknown,session:Session):void {
  assertOriginalCodexNativeLifecycle(owner,session);
  for(const q of session.queue){const m=session.view.messages.find(m=>m.id===q.id);if(m)m.state='cancelled';}session.queue=[];
}

export function buildNativeApprovalInventory(owner:unknown,s:Session):NativeApprovalInventory {
  assertOriginalCodexNativeLifecycle(owner,s);const service=state(owner);service.writeCurrent(s);
    service.assertLiveQuestionTurn(s);
    if (s.pending.size > 32) throw Error('native_approval_inventory_unavailable');
    const questions = [...s.pending.values()].map(p => {
      if (p.connection !== s.client || p.threadId !== s.nativeId || p.turnId !== s.turnId || p.view.expiresAt <= Date.now()) throw Error('native_approval_inventory_unavailable');
      return Object.freeze({ ...p.view, requestDigest: p.digest });
    }).sort((a, b) => a.token.localeCompare(b.token));
    const identity = { sessionId: s.view.id, nativeThreadId: s.nativeId!, turnId: s.turnId!, generation: s.turnGeneration!, incarnation: service.questionIncarnation };
    const inventoryRevision = s.approvalRevision ?? 0;
    const digest = createHash('sha256').update(JSON.stringify({ ...identity, inventoryRevision, questions })).digest('hex');
    const frame = Object.freeze({ ...identity, inventoryRevision, digest, questions: Object.freeze(questions) });
    service.writeCurrent(s);return frame;
}

export function assertNativeLiveQuestionTurn(owner:unknown,s:Session):void {
  assertOriginalCodexNativeLifecycle(owner,s);const service=state(owner);

    if (service.stopping || s.stopping || !s.liveTurn || s.view.status !== 'running' || !s.client || !s.nativeId || !s.turnId || s.client.activeTurnId !== s.turnId) throw Error('native_approval_inventory_unavailable');
}

export function listNativeSessions(owner:unknown,actor:NativeActor):NativeSummary[] {const service=state(owner); service.authorize(actor); return [...service.sessions.values()].map(({view:{id,title,cwd,status,updatedAt,error}})=>({id,title,cwd,status,updatedAt,error})).sort((a,b)=>b.updatedAt-a.updatedAt); }

export function revokeNativeQuestions(owner:unknown,s:Session):void {assertOriginalCodexNativeLifecycle(owner,s);const service=state(owner);s.liveTurn=false;if(s.pending.size)service.advanceApprovalRevision(s);for(const p of s.pending.values()){clearTimeout(p.timer);p.resolve({decision:'decline'});}s.pending.clear();}
