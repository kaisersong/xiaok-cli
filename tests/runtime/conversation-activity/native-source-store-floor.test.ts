import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
const cleanup:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const reference={sourceKind:'codex_native_approval',taskId:'task',taskSessionId:'host-session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()};
function fixture(){const root=mkdtempSync(join(tmpdir(),'native-activity-floor-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'activity.sqlite');const store=new ConversationActivityStore(file);cleanup.push(()=>store.close());store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run'});return{root,file,store};}
const event={schemaVersion:1,eventId:'start',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'started',receivedAt:1,evidenceRefs:[]};
function version(file:string){const db=new DatabaseSync(file,{readOnly:true});try{return (db.prepare('PRAGMA user_version').get() as any).user_version;}finally{db.close();}}
it('enrolls only the exact original task/thread/session binding and upgrades the metadata floor atomically',()=>{
 const f=fixture();expect(version(f.file)).toBe(4);
 for(const bad of [{...reference,taskId:'foreign'},{...reference,taskSessionId:'foreign'},{...reference,executionThreadId:'foreign'}])expect(()=>f.store.enrollNativeAttentionSource('watch',bad)).toThrow(/native_source/);
 expect(version(f.file)).toBe(4);const result=f.store.enrollNativeAttentionSource('watch',reference);expect(version(f.file)).toBe(5);expect(result.enrollment.reference).toEqual(reference);
 expect(f.store.enrollNativeAttentionSource('watch',reference).enrollment).toEqual(result.enrollment);
 expect(()=>f.store.enrollNativeAttentionSource('watch',{...reference,nativeTurnId:'replacement'})).toThrow(/native_source/);
});
it('requires the original private delivery at every source mutation sibling before any cursor or projection change',()=>{
 const f=fixture();const {delivery}=f.store.enrollNativeAttentionSource('watch',reference);const before=f.store.getProjection('watch');
 for(const mutate of [()=>f.store.ingest('watch',event),()=>f.store.ingest('watch',{...event,schemaVersion:999}),()=>f.store.ingestRetainedPage('watch',{sourceDataEpoch:'host-session',coveredThrough:2,gapRanges:[{from:1,through:2}],events:[]}),()=>f.store.reconcileSnapshot('watch','host-session',2,'completed',false),()=>f.store.setFreshness('watch','fresh')]){
  expect(mutate).toThrow('activity_native_source_delivery_required');expect(f.store.getProjection('watch')).toEqual(before);
 }
 expect(()=>f.store.ingest('watch',event,structuredClone(delivery))).toThrow('activity_native_source_delivery_required');
 f.store.ingest('watch',event,delivery);expect(f.store.getProjection('watch')?.executionState).toBe('running');
 f.store.revokeNativeAttentionDelivery(delivery);expect(()=>f.store.ingest('watch',{...event,eventId:'end',sourceSequence:2,kind:'completed'},delivery)).toThrow('activity_native_source_delivery_required');
});
it('persists the Native restriction through owner restart without downgrading the original schema or reviving a copied delivery',()=>{
 const f=fixture();const {delivery}=f.store.enrollNativeAttentionSource('watch',reference);f.store.close();const next=new ConversationActivityStore(f.file);cleanup.push(()=>next.close());
 expect(version(f.file)).toBe(5);expect(next.getNativeAttentionEnrollment('watch')?.reference).toEqual(reference);
 expect(()=>next.ingest('watch',event,delivery)).toThrow('activity_native_source_delivery_required');expect(()=>next.ingest('watch',event)).toThrow('activity_native_source_delivery_required');
 const current=next.enrollNativeAttentionSource('watch',reference);next.ingest('watch',event,current.delivery);expect(next.getProjection('watch')?.executionState).toBe('running');
});
it('rolls back the new floor when the actual original enrollment transaction fails',()=>{
 const f=fixture();const db=new DatabaseSync(f.file);try{
  db.exec("CREATE TRIGGER native_enrollment_fault BEFORE INSERT ON activity_attention_native_sources BEGIN SELECT RAISE(ABORT,'native_enrollment_io_sentinel'); END");
  expect(()=>f.store.enrollNativeAttentionSource('watch',reference)).toThrow('native_enrollment_io_sentinel');expect(version(f.file)).toBe(4);expect(f.store.getNativeAttentionEnrollment('watch')).toBeNull();
 }finally{db.close();}
});
it('uses the actual frozen profile4 Store owner lock and rejects its business writer after the new floor',async()=>{
 const f=fixture();f.store.close();const snapshot=resolve('tests/runtime/conversation-activity/fixtures/store-profile4.original.ts.txt');const output=join(f.root,'profile4-original.mjs');
 await build({stdin:{contents:readFileSync(snapshot,'utf8'),resolveDir:resolve('src/runtime/conversation-activity'),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:output,logLevel:'silent'});
 const {ConversationActivityStore:Original}=await import(pathToFileURL(output).href);const old=new Original(f.file);try{expect(()=>new ConversationActivityStore(f.file)).toThrow('conversation_activity_owner_held');}finally{old.close();}
 const current=new ConversationActivityStore(f.file);current.enrollNativeAttentionSource('watch',reference);current.close();
 expect(()=>new Original(f.file)).toThrow('conversation_activity_schema_unsupported');expect(version(f.file)).toBe(5);
 const reader=new ConversationActivityStore(f.file,{readOnly:true});try{expect(reader.getWatch('watch')?.workId).toBe('task');}finally{reader.close();}
});
