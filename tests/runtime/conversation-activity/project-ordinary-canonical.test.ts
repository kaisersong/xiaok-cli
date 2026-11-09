import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DatabaseSync} from 'node:sqlite';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import * as canonical from '../../../src/runtime/conversation-activity/attention-canonical-state.js';
import {createOrdinaryAttentionFacts} from '../../../src/runtime/conversation-activity/ordinary-attention-facts.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-ordinary-canonical-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new ConversationActivityStore(join(root,'activity.sqlite'));cleanup.push(()=>store.close());
 const internal=store as unknown as{db:DatabaseSync;transaction<T>(run:()=>T):T},ordinary=createOrdinaryAttentionFacts(internal.db);let seq=0;
 const bind=(id:string)=>{store.prepareAssociation({operationId:id,creationIdempotencyKey:id,origin:{profileId:'profile',workspaceId:'workspace',threadId:id,actorId:'user'}});store.bindWork({operationId:id,watchId:id,source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:'epoch',workId:'p'});};
 const event=(kind:string)=>{seq++;store.ingest('watch',{schemaVersion:1,eventId:String(seq),source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:'epoch',workId:'p',transportGeneration:0,sourceSequence:seq,kind,receivedAt:seq,evidenceRefs:[]});};
 const read=(ids=['watch'])=>internal.transaction(()=>{
  const facts=ids.map(id=>{const watch=store.getWatch(id)!;const row=internal.db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(id) as{data_json:string};return ordinary.read(watch,row.data_json);});
  return canonical.canonicalOrdinaryAttentionState(internal.db,'project-anchor',facts);
 });
 bind('watch');return{store,db:internal.db,bind,event,read};
}
it('retains existing ordinary lineage across a real running-blocked-running ABA without an intermediate presentation read',()=>{
 const f=fixture();f.event('started');const first=f.read();f.event('blocked');f.event('started');const again=f.read();expect(again.canonicalRef.factId).toBe(first.canonicalRef.factId);expect(again.canonicalRef.revision).toBe(first.canonicalRef.revision+1);expect(again.sourceFacts).toEqual([]);
});
it('adds an actual project alias without advancing the physical ordinary canonical revision',()=>{
 const f=fixture(),first=f.read();f.bind('alias');const after=f.read(['alias','watch']);expect(after.canonicalRef).toEqual(first.canonicalRef);
});
it('does not advance ordinary canonical state for a real heartbeat',()=>{
 const f=fixture();f.event('started');const first=f.read();f.event('heartbeat');expect(f.read().canonicalRef).toEqual(first.canonicalRef);
});
it('preserves input-required priority without fabricating a question inventory',()=>{
 const f=fixture();f.event('input_required');expect(f.read().sourceFacts).toMatchObject([{reasonCode:'input_required'}]);
});
it.each(['facts','heads'])('does not return a canonical birth when SQLite ignores its %s insert',table=>{
 const f=fixture();f.db.exec(`CREATE TRIGGER ignore_canonical_birth BEFORE INSERT ON activity_attention_core_${table} BEGIN SELECT RAISE(IGNORE); END`);
 expect(()=>f.read()).toThrow(/integrity/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_attention_core_facts').get()).toMatchObject({n:0});expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_attention_core_heads').get()).toMatchObject({n:0});
});
