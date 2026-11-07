// @vitest-environment node
import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRootResourceJournal} from '../../electron/desktop-root-resource-store.js';
const require=createRequire(import.meta.url);

function withReservation(work:(state:{native:any;session:any;db:DatabaseSync;golden:any[];facts:any[];domain:string;assertCommonEnqueue:()=>void})=>void,population=6){
 const root=mkdtempSync(join(tmpdir(),'native-root-reservation-')),domain=join(root,'native');mkdirSync(domain);
 const scope={profileId:'fixture-profile',workspaceId:'fixture-workspace',principalId:'fixture-principal'};
 const subjects=[{kind:'room_turn',roomId:'fixture-room',turnId:'fixture-turn-0',logicalAgentId:'fixture-agent'},{kind:'room_project',projectId:'fixture-project',taskId:'fixture-task-1',runId:'fixture-run-1',roomId:'fixture-room'},{kind:'kswarm_task',projectId:'fixture-project',taskId:'fixture-task-2',runId:'fixture-run-2'},{kind:'workflow_root',workflowId:'fixture-workflow',workflowRootId:'fixture-root',runId:'fixture-run-3'},{kind:'dsh_draft',ownerWorkId:'fixture-owner',draftInvocationId:'fixture-draft-4'},{kind:'room_turn',roomId:'fixture-room',turnId:'fixture-turn-5',logicalAgentId:'fixture-agent'}];
 const classes=['room_discussion','room_project','kswarm_direct','workflow_root','dsh_draft','room_discussion'];
 const baseFacts=subjects.map((subject,index)=>({executionKey:'fixture-root-'+index,payloadHash:'1'.repeat(64),executionClass:classes[index],priorityClass:index===4?'background':'human_followup',scope,subject,authorizationRef:'fixture-original-reference'}));
 const facts=population===-2?baseFacts.map(fact=>({...fact,deadlineAt:0})):population===-1?[...baseFacts,{...baseFacts[0],payloadHash:'2'.repeat(64)}]:population===6?baseFacts:Array.from({length:population},(_,index)=>({...baseFacts[0],executionKey:'fixture-root-'+index,subject:{...subjects[0],turnId:'fixture-turn-'+index}}));
 const authority={},known=new WeakMap(),context={requestSource:'scheduler' as const,authority},originalFile=join(root,'original.sqlite');
 const original=createRootResourceJournal({path:originalFile,authority,queueLimit:4096,issuer:{hostId:'fixture-host',hostBootId:'fixture-boot',runtimeEpoch:1},verifySubject(proof){const value=known.get(proof);if(!value)throw Error('metadata fixture membership');return value;},isEligible(){return true;},verifyExit(){throw Error('no exit grant');}});
 let golden:any[],native:any,session:any,db:DatabaseSync|undefined,failed=false,failure:unknown;const directCalls:any[]=[];
 const run:typeof spawnSync=((...args:any[])=>{const value=(spawnSync as any)(...args);directCalls.push({pid:value.pid??null,status:value.status,signal:value.signal,errorCode:value.error?.code??null});return value;}) as typeof spawnSync;
 try{
  // Actual metadata production API generates bytes, never Native authority.
  for(const fact of population===-1?facts.slice(0,-1):facts){const proof=Object.freeze({});known.set(proof,fact);original.enqueueRoot(proof,context);}
  const source=new DatabaseSync(originalFile,{readOnly:true});try{golden=source.prepare('SELECT execution_key,metadata_json,metadata_digest FROM root_resources ORDER BY enqueue_seq').all();}finally{source.close();}
  original.close(context);
  if(population===-1){const otherAuthority={},otherProof=Object.freeze({}),otherFile=join(root,'conflict-original.sqlite'),otherContext={requestSource:'scheduler' as const,authority:otherAuthority};const other=createRootResourceJournal({path:otherFile,authority:otherAuthority,issuer:{hostId:'fixture-host',hostBootId:'fixture-boot',runtimeEpoch:1},verifySubject(proof){if(proof!==otherProof)throw Error('other golden member');return facts[facts.length-1];},isEligible(){return true;},verifyExit(){throw Error('no exit grant');}});try{other.enqueueRoot(otherProof,otherContext);const read=new DatabaseSync(otherFile,{readOnly:true});try{golden.push(read.prepare('SELECT execution_key,metadata_json,metadata_digest FROM root_resources').get());}finally{read.close();}}finally{other.close(otherContext);}}
  const header=join(root,'facts.h');writeFileSync(header,'static const char *nr_fixture_metadata[]={'+golden.map(row=>JSON.stringify(row.metadata_json)).join(',')+'};\nstatic const char *nr_fixture_execution_keys[]={'+golden.map(row=>JSON.stringify(row.execution_key)).join(',')+'};\nstatic const int nr_fixture_priorities[]={'+facts.map(fact=>fact.priorityClass==='human_followup'?1:0).join(',')+'};\n#define NR_FIXTURE_FACT_COUNT '+facts.length+'\n');
  const sdk=run('xcrun',['--show-sdk-path'],{encoding:'utf8'});expect(sdk.status,sdk.stderr).toBe(0);
  // The test account stays isolated; this override selects compiler headers
  // only, never the Native runtime domain or a production account database.
  const includes=process.env.XIAOK_NATIVE_TEST_INCLUDE_DIR??join(userInfo().homedir,'Library/Caches/node-gyp/24.16.0/include/node');
  expect(existsSync(join(includes,'node_api.h')),'provide cached Native compiler headers for the isolated test account').toBe(true);
  const addon=join(root,'native.node'),build=run('cc',['-std=c11','-Werror','-Wno-deprecated-declarations','-bundle','-undefined','dynamic_lookup','-isysroot',sdk.stdout.trim(),'-I',includes,'-DNAPI_VERSION=8','-DNR_FIXTURE_BUILD=1','-DNR_FIXTURE_ROOT='+JSON.stringify(realpathSync(domain)),'-DNR_FIXTURE_FACTS_HEADER='+JSON.stringify(header),resolve('../native/root-resource-authority/root_resource_authority.c'),'-lsqlite3','-o',addon],{encoding:'utf8'});expect(build.status,build.stderr).toBe(0);
  native=require(addon);expect(native.buildInfo().nativeQualified).toBe(false);expect(native.buildInfo().buildKind).toBe('fixture');expect(native.buildInfo().compiledFixtureRoot).toBe(realpathSync(domain));session=native.openOriginal();native.installFresh(session);
  const assertCommonEnqueue=()=>{
   const clean=(root:any)=>{const labels=new Map<string,string>();const walk=(value:any):any=>Array.isArray(value)?value.map(walk):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['id','loc','range','typeAliasDeclId','referencedMemberDecl','previousDecl'].includes(key)).map(([key,item])=>{
    if((key==='targetLabelDeclId'||key==='declId')&&typeof item==='string'){if(!labels.has(item))labels.set(item,'label-'+labels.size);return[key,labels.get(item)];}return[key,walk(item)];})):value;return walk(root);};
   const body=(fixture:boolean,entry:string)=>{const result=run('cc',['-std=c11','-fsyntax-only','-isysroot',sdk.stdout.trim(),'-I',includes,'-DNAPI_VERSION=8',...(fixture?['-DNR_FIXTURE_BUILD=1','-DNR_FIXTURE_ROOT='+JSON.stringify(realpathSync(domain)),'-DNR_FIXTURE_FACTS_HEADER='+JSON.stringify(header)]:[]),'-Xclang','-ast-dump=json','-Xclang','-ast-dump-filter='+entry,resolve('../native/root-resource-authority/root_resource_authority.c')],{encoding:'utf8',maxBuffer:8*1024*1024});expect(result.status,result.stderr).toBe(0);const ast=JSON.parse(result.stdout);return clean(ast.inner.find((node:any)=>node.kind==='CompoundStmt'));};
   for(const entry of ['enqueue_resource','cancel_queued_resource'])expect(body(false,entry),'production and fixture must compile the same Native '+entry+' algorithm').toEqual(body(true,entry));
  };
  db=new DatabaseSync(join(domain,'root-resource-v1.sqlite'),{readOnly:true});work({native,session,db,golden,facts,domain,assertCommonEnqueue});
 }catch(error){failed=true;failure=error;}finally{
  const cleanup:unknown[]=[];for(const close of [()=>{if(session)native.close(session);},()=>db?.close(),()=>original.close(context),()=>rmSync(root,{recursive:true,force:true})])try{close();}catch(error){cleanup.push(error);}
  console.log(JSON.stringify({fixture:'native-root-reservation',directSpawnSyncCalls:directCalls,allDirectCallsReturned:directCalls.every(row=>row.status!==null||row.signal!==null||row.errorCode!==null),cleanupErrors:cleanup.length,notProductionResourceFinish:true}));
  if(!failed&&cleanup.length){failed=true;failure=new AggregateError(cleanup,'Native fixture cleanup failed');}
 }
 if(failed)throw failure;
}

it.skipIf(process.platform!=='darwin')('uses the original Native resource tables for finite 3:1 claims and one-use launch consumption',()=>withReservation(({native,session,db,golden,facts})=>{
  expect(typeof native.fixtureSubject).toBe('function');
  const capabilities=facts.map((_,index)=>native.fixtureSubject(session,index));
  for(const index of [-1,6,0.1,'0',{},new Number(0)])expect(()=>native.fixtureSubject(session,index)).toThrow(/SUBJECT|INDEX|ARGUMENT/);
  let getters=0;const fake=Object.defineProperty({},'metadata',{get(){getters++;throw Error('forbidden');}});
  for(const value of [fake,{...capabilities[0]},Object.create(capabilities[0]),new Proxy(capabilities[0],{get(){getters++;throw Error('forbidden');}}),null])expect(()=>native.enqueue(session,value)).toThrow(/SUBJECT/);expect(getters).toBe(0);
  let setters=0;Object.defineProperty(Object.prototype,'metadataDigest',{configurable:true,set(){setters++;}});
  try{for(let i=0;i<capabilities.length;i++){const added=native.enqueue(session,capabilities[i]);expect(added.disposition).toBe('new_queued');expect(added.record.metadataDigest).toBe(golden[i].metadata_digest);expect(added.record.executionKey).toBe(golden[i].execution_key);expect(native.enqueue(session,capabilities[i]).disposition).toBe('existing_queued');}}finally{delete Object.prototype.metadataDigest;}expect(setters).toBe(0);
  expect(native.readPolicy(session).enqueueSeq).toBe(6);
  expect(db.prepare('SELECT execution_key,metadata_json,metadata_digest FROM root_resources ORDER BY enqueue_seq').all()).toEqual(golden);
  const reservations:any[]=[],claims:any[]=[];for(const index of [0,1,2,4,3]){const claim=native.claimNext(session);expect(claim.record.executionKey).toBe('fixture-root-'+index);expect(claim.record.acquireGeneration).toBe(1);expect(claim.reservation).toBeTruthy();expect(typeof claim.reservation).toBe('object');reservations.push(claim.reservation);claims.push(claim.record);}
  expect(native.claimNext(session)).toBe(null);expect(native.readPolicy(session).claimSeq).toBe(5);
  expect(db.prepare("SELECT count(*) AS n FROM root_resources WHERE state='reserved'").get()?.n).toBe(5);
  expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='reserved'").get()?.n).toBe(5);
  expect(db.prepare("SELECT count(*) AS n FROM root_launch_outbox WHERE state='pending'").get()?.n).toBe(5);
  for(let i=0;i<reservations.length;i++){const reservation=reservations[i],claim=claims[i];expect(()=>native.consumeLaunch(session,{...reservation})).toThrow(/RESERVATION/);const first=native.consumeLaunch(session,reservation),again=native.consumeLaunch(session,reservation);expect(first.record).toBeTruthy();expect(first.receipt).toBeTruthy();expect(first.newlyConsumed).toBe(true);expect(again.newlyConsumed).toBe(false);expect(again.record).toEqual(first.record);
   expect(first.record).toEqual({...claim,outboxRevision:1});expect(native.readRecord(session,claim.executionKey)).toEqual(first.record);
   const receipt=db.prepare("SELECT binding_hash,receipt_json FROM root_resource_receipts WHERE record_id=? AND kind='launch_consumed'").get(claim.recordId) as any;
   expect(receipt).toBeTruthy();expect(JSON.parse(receipt.receipt_json)).toEqual({acquireGeneration:claim.acquireGeneration,attemptId:claim.attemptId,claimToken:claim.claimToken,issuerEpoch:claim.issuerEpoch,metadataDigest:claim.metadataDigest,recordId:claim.recordId});
   expect(db.prepare('SELECT revision,state FROM root_launch_outbox WHERE record_id=?').get(claim.recordId)).toEqual({revision:1,state:'consumed'});
  }
  expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='launch_consumed'").get()?.n).toBe(5);expect(native.claimNext(session)).toBe(null);
  native.close(session);for(const reservation of reservations)expect(()=>native.consumeLaunch(session,reservation)).toThrow(/CLOSED/);
  const cold=native.openOriginal();try{expect(native.readPolicy(cold).claimSeq).toBe(5);for(const operation of [()=>native.fixtureSubject(cold,0),()=>native.enqueue(cold,capabilities[0]),()=>native.claimNext(cold),()=>native.consumeLaunch(cold,reservations[0])])expect(operation).toThrow(/RECONCILIATION|SESSION|SUBJECT|RESERVATION/);}finally{native.close(cold);}
}));

for(const operation of ['claim','consume'])it.skipIf(process.platform!=='darwin')('holds actual committed resource truth after a controlled '+operation+' COMMIT SDK wrapper failure',()=>withReservation(({native,session,db})=>{
 expect(typeof native.armCommitWrapperFailure).toBe('function');
 const subject=native.fixtureSubject(session,0);native.enqueue(session,subject);
 const reservation=operation==='consume'?native.claimNext(session).reservation:undefined;
 native.armCommitWrapperFailure(session,operation);
 let failure:any;try{if(operation==='claim')native.claimNext(session);else native.consumeLaunch(session,reservation);}catch(error){failure=error;}
 expect(failure?.message).toBe('ROOT_RESOURCE_FIXTURE_COMMIT_WRAPPER_FAILURE');expect(failure.durableCommitted).toBe(true);expect(failure.sqliteCode).toBe(0);
 expect(db.prepare("SELECT count(*) AS n FROM root_resources WHERE state='reserved'").get()?.n).toBe(1);
 expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='reserved'").get()?.n).toBe(1);
 expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='launch_consumed'").get()?.n).toBe(operation==='consume'?1:0);
 expect(()=>native.claimNext(session)).toThrow(/UNCONFIRMED/);
 native.close(session);const cold=native.openOriginal();try{expect(native.readPolicy(cold).claimSeq).toBe(1);expect(()=>native.claimNext(cold)).toThrow(/RECONCILIATION/);}finally{native.close(cold);}
}));

it.skipIf(process.platform!=='darwin')('compiles the same original enqueue state machine into production and fixture Native targets',()=>withReservation(({assertCommonEnqueue})=>assertCommonEnqueue()));

it.skipIf(process.platform!=='darwin')('never rearms a cold queued resource through a fresh wrapper or repeated enqueue',()=>withReservation(({native,session,db})=>{
 const subject=native.fixtureSubject(session,0),added=native.enqueue(session,subject);expect(added.record.state).toBe('queued');expect(native.readPolicy(session).claimSeq).toBe(0);native.close(session);
 const cold=native.openOriginal();try{expect(native.readRecord(cold,added.record.executionKey)).toEqual(added.record);expect(native.readPolicy(cold).enqueueSeq).toBe(1);for(const operation of [()=>native.fixtureSubject(cold,0),()=>native.enqueue(cold,subject),()=>native.claimNext(cold)])expect(operation).toThrow(/RECONCILIATION|SUBJECT|SESSION/);expect(db.prepare("SELECT state,generation FROM root_resources WHERE execution_key=?").get(added.record.executionKey)).toEqual({state:'queued',generation:0});}finally{native.close(cold);}
}));

it.skipIf(process.platform!=='darwin')('rejects a full queue without poisoning the original healthy issuer or preventing it from draining',()=>withReservation(({native,session,db,facts})=>{
 for(let i=0;i<256;i++)expect(native.enqueue(session,native.fixtureSubject(session,i)).disposition).toBe('new_queued');
 expect(native.readPolicy(session).enqueueSeq).toBe(256);const before=db.prepare('SELECT count(*) AS n FROM root_resources').get()?.n;
 expect(()=>native.enqueue(session,native.fixtureSubject(session,256))).toThrow(/QUEUE_CAPACITY/);expect(db.prepare('SELECT count(*) AS n FROM root_resources').get()?.n).toBe(before);
 expect(db.prepare('SELECT next_seq FROM root_resource_policy WHERE singleton=1').get()?.next_seq).toBe(256);
 const claim=native.claimNext(session);expect(claim.record.executionKey).toBe(facts[0].executionKey);expect(native.consumeLaunch(session,claim.reservation).newlyConsumed).toBe(true);expect(native.readPolicy(session).claimSeq).toBe(1);
},257));

it.skipIf(process.platform!=='darwin')('rejects a conflicting original metadata hash without poisoning another accepted subject',()=>withReservation(({native,session,db,golden})=>{
 const original=native.fixtureSubject(session,0),conflict=native.fixtureSubject(session,6),first=native.enqueue(session,original);expect(golden[6].execution_key).toBe(golden[0].execution_key);expect(golden[6].metadata_digest).not.toBe(golden[0].metadata_digest);
 expect(()=>native.enqueue(session,conflict)).toThrow(/INPUT_CONFLICT/);expect(native.readPolicy(session).enqueueSeq).toBe(1);expect(native.readRecord(session,first.record.executionKey).metadataDigest).toBe(golden[0].metadata_digest);
 expect(db.prepare('SELECT count(*) AS n FROM root_resources').get()?.n).toBe(1);const claim=native.claimNext(session);expect(claim.record.metadataDigest).toBe(first.record.metadataDigest);expect(native.consumeLaunch(session,claim.reservation).newlyConsumed).toBe(true);
},-1));
it.skipIf(process.platform!=='darwin')('rejects genuine foreign addon subjects and reservations before any local mutation',()=>withReservation(left=>withReservation(right=>{
 const foreign=left.native.fixtureSubject(left.session,0);expect(()=>right.native.enqueue(right.session,foreign)).toThrow(/SUBJECT/);expect(right.native.readPolicy(right.session).enqueueSeq).toBe(0);
 left.native.enqueue(left.session,foreign);const claim=left.native.claimNext(left.session);expect(()=>right.native.consumeLaunch(right.session,claim.reservation)).toThrow(/RESERVATION/);
 const local=right.native.fixtureSubject(right.session,0);right.native.enqueue(right.session,local);const accepted=right.native.claimNext(right.session);expect(right.native.consumeLaunch(right.session,accepted.reservation).newlyConsumed).toBe(true);expect(left.native.consumeLaunch(left.session,claim.reservation).newlyConsumed).toBe(true);
})));

it.skipIf(process.platform!=='darwin')('rejects ordinary Node insert update and delete writers for every installed Native resource table',()=>withReservation(({native,session,domain})=>{
 const subject=native.fixtureSubject(session,0);native.enqueue(session,subject);const claim=native.claimNext(session);native.consumeLaunch(session,claim.reservation);
 const writer=new DatabaseSync(join(domain,'root-resource-v1.sqlite'));try{
  for(const [table,key]of [['root_resource_floor','singleton'],['root_resource_policy','singleton'],['root_resources','record_id'],['root_launch_outbox','record_id'],['root_resource_receipts','record_id']]){
   for(const sql of [`INSERT INTO ${table} SELECT * FROM ${table}`,`UPDATE ${table} SET ${key}=${key}`,`DELETE FROM ${table}`])expect(()=>writer.prepare(sql).run()).toThrow(/no such function: xiaok_root_resource_reservation_writer_v1/);
  }
 }finally{writer.close();}expect(native.readPolicy(session).claimSeq).toBe(1);expect(native.readRecord(session,claim.record.executionKey).state).toBe('reserved');
}));

it.skipIf(process.platform!=='darwin')('cancels only its original queued resource without consuming a claim or rearming terminal history',()=>withReservation(({native,session,db})=>{
 expect(typeof native.cancelQueued).toBe('function');const subject=native.fixtureSubject(session,0);expect(()=>native.cancelQueued(session,subject)).toThrow(/NOT_QUEUED|NOT_FOUND/);expect(native.readPolicy(session).enqueueSeq).toBe(0);
 const added=native.enqueue(session,subject),cancelled=native.cancelQueued(session,subject);expect(cancelled.cancelled).toBe(true);expect(cancelled.operation).toBe('cancelled_before_launch');expect(cancelled.record).toEqual({...added.record,state:'cancelled_before_launch',revision:added.record.revision+1});expect(cancelled.record.acquireGeneration).toBe(0);expect(cancelled.record.claimToken).toBeUndefined();
 expect(native.readPolicy(session)).toMatchObject({enqueueSeq:1,claimSeq:0,humanBurst:0});expect(db.prepare('SELECT count(*) AS n FROM root_launch_outbox').get()?.n).toBe(0);expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='cancelled_before_launch'").get()?.n).toBe(1);
 const before=JSON.stringify(db.prepare('SELECT * FROM root_resources').all()),again=native.cancelQueued(session,subject);expect(again.cancelled).toBe(false);expect(again.operation).toBe('history');expect(again.record).toEqual(cancelled.record);expect(JSON.stringify(db.prepare('SELECT * FROM root_resources').all())).toBe(before);expect(native.enqueue(session,subject).disposition).toBe('existing_terminal');expect(native.claimNext(session)).toBe(null);
 const next=native.fixtureSubject(session,1);native.enqueue(session,next);expect(native.claimNext(session).record.executionKey).toBe('fixture-root-1');
}));
it.skipIf(process.platform!=='darwin')('never uses queued cancellation to refund an already claimed original resource',()=>withReservation(({native,session,db})=>{
 expect(typeof native.cancelQueued).toBe('function');const subject=native.fixtureSubject(session,0);native.enqueue(session,subject);const claim=native.claimNext(session);expect(()=>native.cancelQueued(session,subject)).toThrow(/ALREADY_CLAIMED|NOT_QUEUED/);expect(native.consumeLaunch(session,claim.reservation).newlyConsumed).toBe(true);expect(native.readPolicy(session).claimSeq).toBe(1);expect(db.prepare("SELECT count(*) AS n FROM root_resources WHERE state='reserved'").get()?.n).toBe(1);
}));
it.skipIf(process.platform!=='darwin')('allows the original owner to cancel an expired queued subject without restoring effect eligibility',()=>withReservation(({native,session})=>{
 expect(typeof native.cancelQueued).toBe('function');const subject=native.fixtureSubject(session,0);native.enqueue(session,subject);expect(native.claimNext(session)).toBe(null);expect(native.cancelQueued(session,subject).cancelled).toBe(true);expect(native.claimNext(session)).toBe(null);expect(native.readPolicy(session).claimSeq).toBe(0);
},-2));

it.skipIf(process.platform!=='darwin')('frees only a queued slot by cancellation without changing fairness or irreversible claim sequence',()=>withReservation(({native,session,db})=>{
 const handles=[];for(let i=0;i<256;i++){const subject=native.fixtureSubject(session,i);handles.push(subject);native.enqueue(session,subject);}const before=JSON.stringify(db.prepare('SELECT * FROM root_resource_policy').all());
 native.cancelQueued(session,handles[0]);expect(JSON.stringify(db.prepare('SELECT * FROM root_resource_policy').all())).toBe(before);expect(db.prepare('SELECT count(*) AS n FROM root_launch_outbox').get()?.n).toBe(0);expect(native.enqueue(session,native.fixtureSubject(session,256)).disposition).toBe('new_queued');expect(db.prepare("SELECT count(*) AS n FROM root_resources WHERE state='queued'").get()?.n).toBe(256);expect(native.readPolicy(session)).toMatchObject({claimSeq:0,humanBurst:0,enqueueSeq:257});
},257));
it.skipIf(process.platform!=='darwin')('keeps actual queued cancellation after its controlled original COMMIT wrapper fails',()=>withReservation(({native,session,db})=>{
 const subject=native.fixtureSubject(session,0),queued=native.enqueue(session,subject);native.armCommitWrapperFailure(session,'cancel');let failure:any;try{native.cancelQueued(session,subject);}catch(error){failure=error;}
 expect(failure?.message).toBe('ROOT_RESOURCE_FIXTURE_COMMIT_WRAPPER_FAILURE');expect(failure.durableCommitted).toBe(true);expect(failure.sqliteCode).toBe(0);expect(db.prepare('SELECT state,generation FROM root_resources WHERE record_id=?').get(queued.record.recordId)).toEqual({state:'cancelled_before_launch',generation:0});expect(db.prepare("SELECT count(*) AS n FROM root_resource_receipts WHERE kind='cancelled_before_launch'").get()?.n).toBe(1);expect(db.prepare('SELECT claim_seq,human_burst FROM root_resource_policy').get()).toEqual({claim_seq:0,human_burst:0});expect(()=>native.claimNext(session)).toThrow(/UNCONFIRMED/);
}));

for(const operation of ['cancel','consume'])for(const change of ['receipt_blob','hash_blob','receipt_nul','hash_nul'])it.skipIf(process.platform!=='darwin')('rejects non-exact '+change+' in original '+operation+' receipt history',()=>withReservation(({native,session,domain})=>{
 const subject=native.fixtureSubject(session,0);native.enqueue(session,subject);let replay:()=>unknown;
 if(operation==='cancel'){native.cancelQueued(session,subject);replay=()=>native.cancelQueued(session,subject);}else{const claim=native.claimNext(session);native.consumeLaunch(session,claim.reservation);replay=()=>native.consumeLaunch(session,claim.reservation);}
 // Controlled corruption on an external fixture connection. Same-UID fake UDF
 // isolation is explicitly OPEN; this only tests the Native history decoder.
 const writer=new DatabaseSync(join(domain,'root-resource-v1.sqlite'));try{writer.function('xiaok_root_resource_reservation_writer_v1',{varargs:true},()=>1);const column=change.startsWith('receipt')?'receipt_json':'binding_hash',expression=change.endsWith('blob')?`CAST(${column} AS BLOB)`:`${column} || char(0) || 'suffix'`;writer.prepare(`UPDATE root_resource_receipts SET ${column}=${expression} WHERE kind=?`).run(operation==='cancel'?'cancelled_before_launch':'launch_consumed');}finally{writer.close();}
 expect(replay).toThrow(/UNCONFIRMED/);
}));
