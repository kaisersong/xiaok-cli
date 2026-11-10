// @vitest-environment node
// Resource-contract fixtures use private verifier doubles; these tests never
// certify native floor, physical exit, Windows or producer activation.
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,renameSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {createRootResourceJournal} from '../../electron/desktop-root-resource-store.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(capacity=5,queueLimit=100){
 const root=mkdtempSync(join(tmpdir(),'root-resource-contract-'));roots.push(root);
 const authority=Object.freeze({}),ctx={requestSource:'scheduler' as const,authority},subjects=new WeakMap<object,any>(),exits=new WeakMap<object,any>(),ineligible=new Set<string>();
 const options={path:join(root,'resource.sqlite'),capacity,queueLimit,authority,issuer:{hostId:'contract-host',hostBootId:'contract-boot',runtimeEpoch:1},
  verifySubject:(proof:object)=>{const fact=subjects.get(proof);if(!fact)throw Error('root_subject_unverified');if(fact.scope.principalId!=='principal')throw Error('root_scope_forbidden');return fact;},
  isEligible:(fact:any)=>!ineligible.has(fact.executionKey),
  verifyExit:(proof:object)=>{const fact=exits.get(proof);if(!fact)throw Error('root_exit_unverified');return fact;}};
 const journal=createRootResourceJournal(options),coordinator=new DesktopExecutionCoordinator({rootResources:journal});
 const subject=(executionKey:string,priorityClass:'human_followup'|'background'='background',change:any={})=>{const proof=Object.freeze({});subjects.set(proof,{executionKey,payloadHash:hash(executionKey),executionClass:'kswarm_direct',priorityClass,scope:{profileId:'profile',workspaceId:'workspace',principalId:'principal'},subject:{kind:'kswarm_task',projectId:'project',taskId:executionKey,runId:'original-run'},authorizationRef:'original-owner-authorization',...change});return proof;};
 const exit=(claim:any,change:any={})=>{const proof=Object.freeze({});exits.set(proof,{recordId:claim.recordId,claimToken:claim.claimToken,attemptId:claim.attemptId,acquireGeneration:claim.acquireGeneration,issuerEpoch:claim.issuerEpoch,metadataDigest:claim.metadataDigest,outboxRevision:claim.outboxRevision,proofDigest:hash('exit:'+claim.claimToken),...change});return proof;};
 return {root,options,journal,coordinator,ctx,subject,exit,ineligible};
}
it('original unqualified coordinator leaves all root APIs unavailable and preserves ordinary lane execution',async()=>{
 const coordinator=new DesktopExecutionCoordinator();let reads=0;const proof={get executionKey(){reads++;throw Error('untrusted getter');}};
 for(const action of [()=>coordinator.enqueueRoot(proof as never,{} as never),()=>coordinator.claimNextRoot({} as never),()=>coordinator.consumeRootLaunch(proof,{} as never),()=>coordinator.ackRootStarted({} as never,{} as never),()=>coordinator.markLaunchUnknownRoot(proof,{} as never),()=>coordinator.requestRootCancel('key',{} as never),()=>coordinator.finishRoot({} as never,{} as never),()=>coordinator.readRootReservation('key',{} as never),()=>coordinator.setRootResourcePolicy({capacity:1,queueLimit:1},{} as never)])expect(action).toThrow('runtime_admission_unavailable');
 expect(reads).toBe(0);expect(await coordinator.run(undefined,async()=>17)).toBe(17);
});
it('the actual journal/coordinator deduplicates immutable root input without using legacy lane permits',()=>{
 const f=fixture();try{
  const first=f.coordinator.enqueueRoot(f.subject('one'),f.ctx),second=f.coordinator.enqueueRoot(f.subject('one'),f.ctx);
  expect(first).toMatchObject({disposition:'new_queued',record:{state:'queued'}});expect(second).toMatchObject({disposition:'existing_queued',record:{recordId:first.record.recordId,enqueueSeq:first.record.enqueueSeq,revision:first.record.revision}});
  expect(()=>f.coordinator.enqueueRoot(f.subject('one','human_followup'),f.ctx)).toThrow('root_input_conflict');
  expect(()=>f.coordinator.enqueueRoot(f.subject('one','background',{payloadHash:hash('changed')}),f.ctx)).toThrow('root_input_conflict');
  expect(()=>f.coordinator.acquireLease({policy:'ordinary'})).toThrow('root_legacy_lane_unavailable');
  expect(()=>f.coordinator.enqueueGroupTurn('old-group')).toThrow('root_legacy_lane_unavailable');
  expect(()=>f.coordinator.joinOrEnqueue('old-group',1,'agent_work')).toThrow('root_legacy_lane_unavailable');
 }finally{f.journal.close();}
});
it.each([1,5,7])('resource N=%s counts actual unreleased reservations, including unknown and cancel pending',capacity=>{
 const f=fixture(capacity);try{
  for(let n=0;n<capacity+1;n++)f.coordinator.enqueueRoot(f.subject('key-'+n),f.ctx);
  const claims=Array.from({length:capacity},()=>f.coordinator.claimNextRoot(f.ctx));expect(claims.every(Boolean)).toBe(true);expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
  f.coordinator.markLaunchUnknownRoot(claims[0],f.ctx);f.coordinator.requestRootCancel(claims[0]!.executionKey,f.ctx);expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
  f.coordinator.finishRoot(f.exit(f.coordinator.readRootReservation(claims[0]!.executionKey,f.ctx)),f.ctx);expect(f.coordinator.claimNextRoot(f.ctx)?.executionKey).toBe('key-'+capacity);
 }finally{f.journal.close();}
});
it('3:1 uses persistent reserved commits, eligible candidates and FIFO; retries and cancelled input cannot wash the burst',()=>{
 const f=fixture(1);try{
  for(let n=0;n<5;n++)f.coordinator.enqueueRoot(f.subject('h'+n,'human_followup'),f.ctx);
  f.coordinator.enqueueRoot(f.subject('b0'),f.ctx);f.ineligible.add('b0');
  for(const expected of ['h0','h1','h2','h3']){const claim=f.coordinator.claimNextRoot(f.ctx)!;expect(claim.executionKey).toBe(expected);f.coordinator.finishRoot(f.exit(claim),f.ctx);}
  expect(f.journal.readPolicy(f.ctx).humanBurst).toBe(3);f.ineligible.delete('b0');
  const background=f.coordinator.claimNextRoot(f.ctx)!;expect(background.executionKey).toBe('b0');expect(f.journal.readPolicy(f.ctx).humanBurst).toBe(0);f.coordinator.finishRoot(f.exit(background),f.ctx);
  expect(f.coordinator.claimNextRoot(f.ctx)?.executionKey).toBe('h4');
 }finally{f.journal.close();}
});
it('both continuously eligible classes commit HHHB, preserve original FIFO and read burst on actual journal reopen',()=>{
 const f=fixture(1);let journal=f.journal;try{
  for(let n=0;n<6;n++)f.coordinator.enqueueRoot(f.subject('h'+n,'human_followup'),f.ctx);for(let n=0;n<2;n++)f.coordinator.enqueueRoot(f.subject('b'+n),f.ctx);
  const order:string[]=[];for(let n=0;n<3;n++){const c=f.coordinator.claimNextRoot(f.ctx)!;order.push(c.executionKey);f.coordinator.finishRoot(f.exit(c),f.ctx);}
  journal.close();journal=createRootResourceJournal(f.options);const reopened=new DesktopExecutionCoordinator({rootResources:journal});expect(journal.readPolicy(f.ctx).humanBurst).toBe(3);
  for(let n=0;n<5;n++){const c=reopened.claimNextRoot(f.ctx)!;order.push(c.executionKey);reopened.finishRoot(f.exit(c),f.ctx);}expect(order).toEqual(['h0','h1','h2','b0','h3','h4','h5','b1']);
 }finally{journal.close();}
});
it('queued cancellation and released replay are terminal observations with no new seq, generation, outbox or receipt',()=>{
 const f=fixture(1);try{
  const queued=f.coordinator.enqueueRoot(f.subject('cancel'),f.ctx);f.coordinator.requestRootCancel('cancel',f.ctx);
  const replay=f.coordinator.enqueueRoot(f.subject('cancel'),f.ctx);expect(replay).toMatchObject({disposition:'existing_terminal',record:{state:'cancelled_before_launch',enqueueSeq:queued.record.enqueueSeq,acquireGeneration:queued.record.acquireGeneration}});expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
  f.coordinator.enqueueRoot(f.subject('done'),f.ctx);const claim=f.coordinator.claimNextRoot(f.ctx)!;expect(f.coordinator.consumeRootLaunch(claim,f.ctx).newlyConsumed).toBe(true);expect(f.coordinator.consumeRootLaunch(claim,f.ctx).newlyConsumed).toBe(false);const started=f.coordinator.ackRootStarted(claim,f.ctx);const proof=f.exit(started),receipt=f.coordinator.finishRoot(proof,f.ctx);
  expect(f.coordinator.finishRoot(proof,f.ctx)).toEqual(receipt);expect(f.coordinator.enqueueRoot(f.subject('done'),f.ctx)).toMatchObject({disposition:'existing_terminal',record:{state:'released',claimToken:claim.claimToken,acquireGeneration:claim.acquireGeneration}});expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
 }finally{f.journal.close();}
});
it('queue limit refuses only new queued work and never changes business state or a technical retry',()=>{
 const f=fixture(1,1);try{
  f.coordinator.enqueueRoot(f.subject('first'),f.ctx);expect(f.coordinator.enqueueRoot(f.subject('first'),f.ctx).disposition).toBe('existing_queued');expect(()=>f.coordinator.enqueueRoot(f.subject('second'),f.ctx)).toThrow('root_queue_capacity_pending');
  const claim=f.coordinator.claimNextRoot(f.ctx)!;expect(f.coordinator.enqueueRoot(f.subject('second'),f.ctx).disposition).toBe('new_queued');expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();expect(claim.state).toBe('reserved');
 }finally{f.journal.close();}
});
it('default deny precedes untrusted input; foreign source, scope and serialized exit cannot issue or release resources',()=>{
 const f=fixture();try{
  let reads=0;const hostile={get executionKey(){reads++;throw Error('getter');}};
  for(const ctx of [undefined,{requestSource:'agent',authority:f.ctx.authority},{requestSource:'user',authority:f.ctx.authority},{requestSource:'scheduler',authority:{}}])expect(()=>f.coordinator.enqueueRoot(hostile as never,ctx as never)).toThrow('root_caller_forbidden');expect(reads).toBe(0);
  expect(()=>f.coordinator.enqueueRoot(f.subject('foreign','background',{scope:{profileId:'p',workspaceId:'w',principalId:'other'}}),f.ctx)).toThrow('root_scope_forbidden');
  f.coordinator.enqueueRoot(f.subject('original'),f.ctx);const claim=f.coordinator.claimNextRoot(f.ctx)!;expect(()=>f.coordinator.finishRoot({...claim,allExited:true} as never,f.ctx)).toThrow('root_exit_unverified');expect(()=>f.coordinator.finishRoot(f.exit(claim,{issuerEpoch:2}),f.ctx)).toThrow('root_exit_binding_conflict');expect(f.coordinator.readRootReservation('original',f.ctx)?.state).toBe('reserved');
 }finally{f.journal.close();}
});
it.each(['main_turn','goal_turn','material_turn','canvas_turn','nested_subagent','admission_probe','live_preview','snapshot_prep','tool_worker'])('non-root %s cannot enter N',executionClass=>{
 const f=fixture();try{expect(()=>f.coordinator.enqueueRoot(f.subject('wrong','background',{executionClass}),f.ctx)).toThrow('root_subject_invalid');expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();}finally{f.journal.close();}
});
it.each([
 ['room_discussion',{kind:'room_turn',roomId:'room',turnId:'turn',logicalAgentId:'agent'}],
 ['room_project',{kind:'room_project',projectId:'project',taskId:'task',runId:'run',roomId:'room'}],
 ['kswarm_direct',{kind:'kswarm_plan',projectId:'project',planGeneration:1,planRunId:'run',enqueueKey:'original-enqueue'}],
 ['workflow_root',{kind:'workflow_root',workflowId:'workflow',workflowRootId:'root',runId:'run'}],
 ['dsh_draft',{kind:'dsh_draft',ownerWorkId:'work',draftInvocationId:'draft'}],
])('accepts the original %s subject without inventing a task identity', (executionClass,subject)=>{
 const f=fixture();try{
  const result=f.coordinator.enqueueRoot(f.subject('original','background',{executionClass,subject}),f.ctx);
  expect(result.record.subject).toEqual(subject);expect(f.coordinator.claimNextRoot(f.ctx)?.executionKey).toBe('original');
 }finally{f.journal.close();}
});
it('rejects mismatched or free-form subjects before any resource write',()=>{
 const f=fixture();try{
  for(const subject of [{kind:'kswarm_task',projectId:'project',taskId:'task',runId:'run',prompt:'plaintext'}, {kind:'dsh_draft',ownerWorkId:'work',draftInvocationId:'draft'}]){
   expect(()=>f.coordinator.enqueueRoot(f.subject('bad','background',{subject}),f.ctx)).toThrow('root_subject_invalid');
  }
  expect(f.journal.readPolicy(f.ctx).enqueueSeq).toBe(0);
 }finally{f.journal.close();}
});
it('fences late launch and old exit facts across cancellation while retaining the original N claim',()=>{
 const f=fixture(1);try{
  f.coordinator.enqueueRoot(f.subject('original'),f.ctx);f.coordinator.enqueueRoot(f.subject('next'),f.ctx);
  const claim=f.coordinator.claimNextRoot(f.ctx)!;
  f.coordinator.consumeRootLaunch(claim,f.ctx);const running=f.coordinator.ackRootStarted(claim,f.ctx),oldExit=f.exit(running);
  const cancelled=f.coordinator.requestRootCancel('original',f.ctx)!;
  expect(()=>f.coordinator.finishRoot(oldExit,f.ctx)).toThrow('root_exit_binding_conflict');
  expect(f.coordinator.consumeRootLaunch(claim,f.ctx).newlyConsumed).toBe(false);
  expect(f.coordinator.ackRootStarted(claim,f.ctx).state).toBe('cancel_pending');
  expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
  f.coordinator.finishRoot(f.exit(cancelled),f.ctx);expect(f.coordinator.claimNextRoot(f.ctx)?.executionKey).toBe('next');
 }finally{f.journal.close();}
});
it('cancel before launch prevents consumption, keeps N and requires the exact fenced exit revision',()=>{
 const f=fixture(1);try{
  f.coordinator.enqueueRoot(f.subject('original'),f.ctx);const claim=f.coordinator.claimNextRoot(f.ctx)!;
  const cancelled=f.coordinator.requestRootCancel('original',f.ctx)!;
  expect(()=>f.coordinator.consumeRootLaunch(claim,f.ctx)).toThrow('root_launch_fenced');
  expect(()=>f.coordinator.ackRootStarted(claim,f.ctx)).toThrow('root_launch_not_consumed');
  expect(()=>f.coordinator.finishRoot(f.exit(claim),f.ctx)).toThrow('root_exit_binding_conflict');
  expect(f.coordinator.finishRoot(f.exit(cancelled),f.ctx)).toMatchObject({state:'released'});
 }finally{f.journal.close();}
});
it('changing capacity never releases original reservations and status/control remain reachable when over the new N',()=>{
 const f=fixture(5);try{
  for(let n=0;n<6;n++)f.coordinator.enqueueRoot(f.subject('key-'+n),f.ctx);
  const claims=Array.from({length:5},()=>f.coordinator.claimNextRoot(f.ctx)!);
  f.coordinator.setRootResourcePolicy({capacity:1,queueLimit:100},f.ctx);
  for(const claim of claims.slice(0,4)){
   expect(f.coordinator.readRootReservation(claim.executionKey,f.ctx)?.state).toBe('reserved');
   const cancelled=f.coordinator.requestRootCancel(claim.executionKey,f.ctx)!;
   f.coordinator.finishRoot(f.exit(cancelled),f.ctx);expect(f.coordinator.claimNextRoot(f.ctx)).toBeNull();
  }
  f.coordinator.finishRoot(f.exit(claims[4]),f.ctx);expect(f.coordinator.claimNextRoot(f.ctx)?.executionKey).toBe('key-5');
 }finally{f.journal.close();}
});
it('captures trusted verifier references and pins the original journal inode for this authority',()=>{
 const f=fixture();try{
  f.options.verifySubject=()=>{throw Error('mutable options used');};
  expect(f.coordinator.enqueueRoot(f.subject('original'),f.ctx).disposition).toBe('new_queued');
  expect(()=>createRootResourceJournal({...f.options,path:join(f.root,'another.sqlite') })).toThrow('root_journal_identity_changed');
  renameSync(f.options.path,join(f.root,'moved.sqlite'));
  expect(()=>f.coordinator.claimNextRoot(f.ctx)).toThrow();
  expect(()=>createRootResourceJournal(f.options)).toThrow('root_journal_identity_changed');
 }finally{f.journal.close();}
});
it('a second in-process caller object cannot take over by copying issuer strings; SQL guards preserve immutable facts',()=>{
 const f=fixture();try{
  f.coordinator.enqueueRoot(f.subject('original'),f.ctx);const claim=f.coordinator.claimNextRoot(f.ctx)!;
  expect(()=>createRootResourceJournal({...f.options,authority:{}})).toThrow('root_issuer_conflict');
  const raw=new DatabaseSync(f.options.path);try{
   expect(()=>raw.prepare('DELETE FROM root_resources WHERE record_id=?').run(claim.recordId)).toThrow('root_resource_delete_forbidden');
   expect(()=>raw.prepare("UPDATE root_resources SET state='queued',revision=revision+1 WHERE record_id=?").run(claim.recordId)).toThrow('root_resource_immutable');
   expect(()=>raw.prepare('UPDATE root_resource_receipts SET receipt_json=? WHERE record_id=?').run('{}',claim.recordId)).toThrow('root_receipt_immutable');
   expect(()=>raw.prepare('DELETE FROM root_launch_outbox WHERE record_id=?').run(claim.recordId)).toThrow('root_outbox_delete_forbidden');
  }finally{raw.close();}
  expect(f.coordinator.readRootReservation('original',f.ctx)?.claimToken).toBe(claim.claimToken);
 }finally{f.journal.close();}
});
it('an actual launch-outbox SQL failure rolls back the reservation, receipt and fairness in the same owner transaction',()=>{
 const f=fixture(1);let reopened:ReturnType<typeof createRootResourceJournal>|undefined;try{
  const original=f.coordinator.enqueueRoot(f.subject('human','human_followup'),f.ctx).record;
  const raw=new DatabaseSync(f.options.path);raw.exec("CREATE TRIGGER fixture_reject_outbox BEFORE INSERT ON root_launch_outbox BEGIN SELECT RAISE(ABORT,'fixture_actual_sql_failure'); END");
  expect(()=>f.coordinator.claimNextRoot(f.ctx)).toThrow('fixture_actual_sql_failure');
  expect(()=>f.coordinator.claimNextRoot(f.ctx)).toThrow('root_journal_unconfirmed');
  expect(raw.prepare('SELECT count(*) AS n FROM root_resource_receipts').get()?.n).toBe(0);
  expect(raw.prepare('SELECT count(*) AS n FROM root_launch_outbox').get()?.n).toBe(0);
  raw.exec('DROP TRIGGER fixture_reject_outbox');raw.close();f.journal.close();
  reopened=createRootResourceJournal(f.options);
  expect(reopened.readReservation('human',f.ctx)).toMatchObject({recordId:original.recordId,state:'queued',revision:original.revision,acquireGeneration:0});
  expect(reopened.readPolicy(f.ctx)).toMatchObject({humanBurst:0,claimSeq:0,enqueueSeq:1});
  expect(reopened.claimNext(f.ctx)?.state).toBe('reserved');
 }finally{reopened?.close();f.journal.close();}
});
it('a retained receipt with different bytes cannot authorize a replay even if its original binding hash is intact',()=>{
 const f=fixture();try{
  f.coordinator.enqueueRoot(f.subject('original'),f.ctx);const claim=f.coordinator.claimNextRoot(f.ctx)!;
  f.coordinator.consumeRootLaunch(claim,f.ctx);
  const raw=new DatabaseSync(f.options.path);try{
   raw.exec('DROP TRIGGER root_receipt_no_update');
   raw.prepare("UPDATE root_resource_receipts SET receipt_json=? WHERE record_id=? AND kind='launch_consumed'").run(JSON.stringify({recordId:claim.recordId,claimToken:'different'}),claim.recordId);
  }finally{raw.close();}
  expect(()=>f.coordinator.consumeRootLaunch(claim,f.ctx)).toThrow('root_receipt_corrupt');
  expect(()=>f.coordinator.ackRootStarted(claim,f.ctx)).toThrow('root_journal_unconfirmed');
 }finally{f.journal.close();}
});
async function childProbe(mode:string,path:string){
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../fixtures/root-resource-issuer-probe.ts',import.meta.url)),mode,path],{stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{errors+=chunk;});
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const ready=new Promise<any>((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}});void exit.then(()=>{if(!output.includes('\n'))reject(Error(errors||'probe_exited_without_receipt'));},reject);});
 return {child,exit,ready};
}
it('a real second Node issuer cannot acquire the occupied journal by replaying public issuer metadata',async()=>{
 const f=fixture(),probe=await childProbe('conflicting_issuer',f.options.path);try{
  expect(await probe.ready).toMatchObject({kind:'constructor_rejected',error:'root_issuer_conflict',pid:probe.child.pid});
  expect(await probe.exit).toEqual({code:0,signal:null});
  expect(f.journal.readPolicy(f.ctx)).toMatchObject({enqueueSeq:0,claimSeq:0});
  console.log(JSON.stringify({test:'root-real-issuer-conflict',pid:probe.child.pid,reaped:true}));
 }finally{if(probe.child.exitCode===null&&probe.child.signalCode===null)probe.child.kill('SIGKILL');await probe.exit;f.journal.close();}
},15000);
it('SIGKILL after actual reservation COMMIT preserves its outbox and N claim; a new process gets no implicit takeover',async()=>{
 const root=mkdtempSync(join(tmpdir(),'root-resource-commit-crash-'));roots.push(root);const path=join(root,'resource.sqlite');
 const probe=await childProbe('commit_then_wait',path);try{
  const committed=await probe.ready;expect(committed).toMatchObject({kind:'committed_original_claim',pid:probe.child.pid});
  probe.child.kill('SIGKILL');await probe.exit;
  const raw=new DatabaseSync(path,{readOnly:true});try{
   expect(raw.prepare('SELECT record_id,claim_token,state,generation FROM root_resources').all()).toEqual([{record_id:committed.recordId,claim_token:committed.claimToken,state:'reserved',generation:1}]);
   expect(raw.prepare('SELECT record_id,state,revision FROM root_launch_outbox').all()).toEqual([{record_id:committed.recordId,state:'pending',revision:0}]);
   expect(raw.prepare('SELECT human_burst,claim_seq FROM root_resource_policy').get()).toMatchObject({human_burst:0,claim_seq:1});
  }finally{raw.close();}
  const other=await childProbe('conflicting_issuer',path);try{expect(await other.ready).toMatchObject({error:'root_issuer_conflict'});expect((await other.exit).code).toBe(0);console.log(JSON.stringify({test:'root-post-crash-issuer-denied',pid:other.child.pid,reaped:true}));}finally{if(other.child.exitCode===null&&other.child.signalCode===null)other.child.kill('SIGKILL');await other.exit;}
  console.log(JSON.stringify({test:'root-reservation-commit-crash',pid:probe.child.pid,reaped:true,originalClaimRetained:true,nativeTakeoverQualified:false}));
 }finally{if(probe.child.exitCode===null&&probe.child.signalCode===null)probe.child.kill('SIGKILL');await probe.exit;}
},15000);
