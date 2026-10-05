import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
const definition=(id:string)=>({version:1,obligations:[{obligationId:id,predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]});
function fixture(){const root=mkdtempSync(join(tmpdir(),'loop-native-attempt-')),file=join(root,'loop.sqlite'),store=new LoopStore(file),loopId='artifact-evidence-regression';store.ensureBuiltInLoops(1);store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'builtin-diagnostic',scanner:loopId,objective:'Original',completionCriterion:'Original criterion'},verificationDefinitions:{run:definition('run-original'),stages:{scan:definition('scan-original')}}}});const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');const stage=store.startLoopStage(began.run.id,loopId,'scan',4),p=store.openLoopPublicationProducer(began.run),ef=join(root,'e.sqlite'),e=new CompletionEvidenceStore(ef),scanner=new ArtifactEvidenceRegressionScanner(ef);try{p.recordScan(stage.id,scanner.scan({loopRunId:began.run.id,now:10}),10);}finally{scanner.close();e.close();}const candidates=store.recoverLoopPublicationCandidates({runId:began.run.id,requestSource:'user'}),candidate=candidates.find(x=>x.stageId===null)!,scanCandidate=candidates.find(x=>x.stageId===stage.id)!;return{root,file,store,loopId,candidate,scanCandidate,close(){store.close();rmSync(root,{recursive:true,force:true});}};}
function reserve(f:ReturnType<typeof fixture>,expectedLatestAttemptId:string|null=null,now=20){return f.store.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId,requestSource:'user',now});}
it('derives immutable request identity and exact run or stage definition from actual candidates',()=>{const f=fixture();try{
 const row=reserve(f),stage=f.store.reserveLoopNativeAttempt({candidateId:f.scanCandidate.candidateId,expectedLatestAttemptId:null,requestSource:'user',now:20});
 expect(row).toMatchObject({candidateId:f.candidate.candidateId,revision:1,ordinal:1,originalSource:'user',bindingHash:f.candidate.bindingHash,sourceVectorHash:f.candidate.sourceVectorHash,configurationRevision:1,phase:'reserved',createdAt:20,updatedAt:20});expect(row.enrollmentRequestId).not.toBe(row.applicationRequestId);expect(row.definitionHash).not.toBe(stage.definitionHash);
 expect(f.store.getLoopNativeAttemptTarget(row.attemptId)).toMatchObject({attempt:row,binding:f.candidate.binding,definition:definition('run-original')});expect(f.store.getLoopNativeAttemptTarget(stage.attemptId)).toMatchObject({binding:f.scanCandidate.binding,definition:definition('scan-original')});expect(Object.isFrozen(row)).toBe(true);
 }finally{f.close();}});
it.each(['agent','scheduler'] as const)('rejects %s reserve and leaves no attempt',source=>{const f=fixture();try{
 expect(typeof f.store.reserveLoopNativeAttempt).toBe('function');expect(()=>f.store.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:source,now:20})).toThrow();expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([]);
 }finally{f.close();}});
it.each(['owner','definition','enrollmentRequestId'] as const)('rejects caller injection of %s',key=>{const f=fixture();try{
 expect(typeof f.store.reserveLoopNativeAttempt).toBe('function');const raw={candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user' as const,now:20,[key]:'caller selected'};expect(()=>f.store.reserveLoopNativeAttempt(raw)).toThrow();expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([]);
 }finally{f.close();}});
it('real competing stores obey latest-attempt and revision CAS with only one stage claim',()=>{const f=fixture(),other=new LoopStore(f.file);try{
 const row=reserve(f);expect(()=>other.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user',now:21})).toThrow();expect(()=>reserve(f,row.attemptId,21)).toThrow();
 const updated=other.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21});expect(updated.revision).toBe(2);expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21})).toThrow();expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(updated);
 }finally{other.close();f.close();}});
it('enforces phase edges, scheduler factual-only updates, and immutable terminal',()=>{const f=fixture();try{
 let row=reserve(f);expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'ready',requestSource:'user',now:21})).toThrow();expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'enrolling',requestSource:'scheduler',now:21})).toThrow();
 row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'enrolling',requestSource:'user',now:21});row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'enrolled',requestSource:'scheduler',now:22});
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'binding',requestSource:'scheduler',now:23})).toThrow();row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'binding',requestSource:'user',now:23});row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'ready',requestSource:'user',now:24});
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'stale',requestSource:'scheduler',now:25})).toThrow();expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(row);
 }finally{f.close();}});
it('pause leaves historical target readable but prevents new native claim and ready; factual stale remains writable',()=>{const f=fixture();try{
 let row=reserve(f);row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21});row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:2,phase:'enrolled',requestSource:'user',now:22});const target=f.store.getLoopNativeAttemptTarget(row.attemptId);f.store.setLoopStatus(f.loopId,'paused',23);
 expect(f.store.getLoopNativeAttemptTarget(row.attemptId)).toEqual(target);expect(()=>f.store.assertLoopNativeAttemptCurrent(row.attemptId)).toThrow();expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:3,phase:'binding',requestSource:'user',now:24})).toThrow();const stale=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:3,phase:'stale',requestSource:'scheduler',now:24});expect(stale.phase).toBe('stale');
 }finally{f.close();}});
it('preserves immutable request IDs and exact target across real DB close/reopen',()=>{const f=fixture();let closed=false;try{
 const row=reserve(f),target=f.store.getLoopNativeAttemptTarget(row.attemptId);f.store.close();closed=true;const reopened=new LoopStore(f.file);try{expect(reopened.getLoopNativeAttempt(row.attemptId)).toEqual(row);expect(reopened.getLoopNativeAttemptTarget(row.attemptId)).toEqual(target);expect(reopened.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([row]);expect(()=>reopened.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId:row.attemptId,requestSource:'user',now:21})).toThrow();}finally{reopened.close();}
 }finally{if(!closed)f.store.close();rmSync(f.root,{recursive:true,force:true});}});
it('explicit retired retries use new request IDs and enforce all 32 historical slots',()=>{const f=fixture();try{
 let previous:string|null=null;const requests=new Set<string>();for(let i=0;i<32;i++){const row=reserve(f,previous,20+i*2);expect(row.ordinal).toBe(i+1);if(row.kind!=='enrollment-and-application')throw Error('unexpected application-only reserve');requests.add(row.enrollmentRequestId);requests.add(row.applicationRequestId);f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'retired',requestSource:'user',now:21+i*2});previous=row.attemptId;}
 expect(requests.size).toBe(64);expect(()=>reserve(f,previous,100)).toThrow();expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toHaveLength(32);
 }finally{f.close();}});
it('blocks fresh attempt while original application requires reauthorization',()=>{const f=fixture();try{
 let row=reserve(f);for(const phase of ['enrolling','enrolled','binding','needs_reauthorization'] as const)row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase,requestSource:'user',now:20+row.revision});expect(()=>reserve(f,row.attemptId,30)).toThrow();
 }finally{f.close();}});
it('actual SQLite reserve failure rolls back IDs and latest attempt then allows a clean retry',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 expect(typeof f.store.reserveLoopNativeAttempt).toBe('function');db.exec("CREATE TRIGGER reject_native_attempt BEFORE INSERT ON loop_native_attempts BEGIN SELECT RAISE(ABORT,'attempt write failure'); END");expect(()=>reserve(f)).toThrow('attempt write failure');expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([]);db.exec('DROP TRIGGER reject_native_attempt');expect(reserve(f).ordinal).toBe(1);
 }finally{db.close();f.close();}});
it('rejects accessor input without calling it or creating an attempt',()=>{const f=fixture();try{
 expect(typeof f.store.reserveLoopNativeAttempt).toBe('function');let calls=0;const input={candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user' as const,get now(){calls++;return 20;}};expect(()=>f.store.reserveLoopNativeAttempt(input)).toThrow();expect(calls).toBe(0);expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([]);
 }finally{f.close();}});
it('binding ready cannot be claimed after pause, while original facts can retire stale',()=>{const f=fixture();try{
 let row=reserve(f);for(const phase of ['enrolling','enrolled','binding'] as const)row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase,requestSource:'user',now:20+row.revision});f.store.setLoopStatus(f.loopId,'paused',30);
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'ready',requestSource:'scheduler',now:31})).toThrow();expect(f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase:'stale',requestSource:'scheduler',now:31}).phase).toBe('stale');
 }finally{f.close();}});
it.each(['BEFORE','AFTER'] as const)('rolls back failed %s phase UPDATE and preserves exact original revision',when=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=reserve(f);db.exec(`CREATE TRIGGER fail_phase ${when} UPDATE ON loop_native_attempts BEGIN SELECT RAISE(ABORT,'phase update failure'); END`);
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21})).toThrow('phase update failure');expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(row);
 db.exec('DROP TRIGGER fail_phase');expect(f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21}).phase).toBe('enrolling');
 }finally{db.close();f.close();}});
it('rejects an UPDATE that writes zero rows instead of returning the previous phase as a successful claim',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=reserve(f);db.exec("CREATE TRIGGER ignore_phase BEFORE UPDATE ON loop_native_attempts BEGIN SELECT RAISE(IGNORE); END");
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21})).toThrow();expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(row);
 }finally{db.close();f.close();}});
it('checks candidate target hashes and never accepts corrupted candidate body as historical target',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=reserve(f);db.prepare('UPDATE loop_publication_candidates SET binding_json=? WHERE candidate_id=?').run('{}',f.candidate.candidateId);
 expect(()=>f.store.getLoopNativeAttemptTarget(row.attemptId)).toThrow();expect(()=>f.store.assertLoopNativeAttemptCurrent(row.attemptId)).toThrow();expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(row);
 }finally{db.close();f.close();}});
it('historical target survives real source metadata changes but current admission detects them without database writes',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=f.store.reserveLoopNativeAttempt({candidateId:f.scanCandidate.candidateId,expectedLatestAttemptId:null,requestSource:'user',now:20}),target=f.store.getLoopNativeAttemptTarget(row.attemptId);
 f.store.updateLoopStageMetadata(f.scanCandidate.stageId!,{later:'metadata'});const before=f.store.listLoopPublicationCandidates(f.candidate.runId),version=f.store.getAutomationStoreVersion();
 expect(f.store.getLoopNativeAttemptTarget(row.attemptId)).toEqual(target);expect(()=>f.store.assertLoopNativeAttemptCurrent(row.attemptId)).toThrow('loop_publication_candidate_source_changed');expect(f.store.listLoopPublicationCandidates(f.candidate.runId)).toEqual(before);expect(f.store.getAutomationStoreVersion()).toBe(version);
 }finally{db.close();f.close();}});
it('rejects an INSERT that writes zero rows and rolls back the apparent reservation',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const version=f.store.getAutomationStoreVersion();db.exec("CREATE TRIGGER ignore_reserve BEFORE INSERT ON loop_native_attempts BEGIN SELECT RAISE(IGNORE); END");expect(()=>reserve(f)).toThrow();expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([]);expect(f.store.getAutomationStoreVersion()).toBe(version);
 }finally{db.close();f.close();}});
it('phase commit cannot silently change immutable request identity inside the transaction',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=reserve(f);db.exec("CREATE TRIGGER change_request AFTER UPDATE OF phase ON loop_native_attempts BEGIN UPDATE loop_native_attempts SET enrollment_request_id='changed-by-trigger' WHERE attempt_id=NEW.attempt_id; END");
 expect(()=>f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:1,phase:'enrolling',requestSource:'user',now:21})).toThrow();expect(f.store.getLoopNativeAttempt(row.attemptId)).toEqual(row);
 }finally{db.close();f.close();}});

it('migrates original native rows and populated dependent foreign keys without losing original identities',()=>{const f=fixture();let closed=false;try{
 const old=reserve(f);f.store.close();closed=true;
 const db=new DatabaseSync(f.file);db.exec('PRAGMA foreign_keys=OFF');
 db.exec(`CREATE TABLE legacy_native (attempt_id text primary key,candidate_id text not null references loop_publication_candidates(candidate_id),revision integer not null,ordinal integer not null,original_source text not null,binding_hash text not null,source_vector_hash text not null,configuration_revision integer not null,definition_hash text not null,enrollment_request_id text not null unique,application_request_id text not null unique,phase text not null,created_at integer not null,updated_at integer not null,unique(candidate_id,ordinal));
 INSERT INTO legacy_native SELECT attempt_id,candidate_id,revision,ordinal,original_source,binding_hash,source_vector_hash,configuration_revision,definition_hash,enrollment_request_id,application_request_id,phase,created_at,updated_at FROM loop_native_attempts;
 DROP TABLE loop_native_attempts;ALTER TABLE legacy_native RENAME TO loop_native_attempts;`);db.exec('PRAGMA foreign_keys=ON');
 db.exec('CREATE TABLE native_migration_child (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES loop_native_attempts(attempt_id))');
 db.prepare('INSERT INTO native_migration_child VALUES(?,?)').run('child',old.attemptId);db.close();
 const reopened=new LoopStore(f.file);try{
  const actual=reopened.getLoopNativeAttempt(old.attemptId);expect(actual).toEqual({...old,kind:'enrollment-and-application',enrollmentSourceAttemptId:null,reauthorizesAttemptId:null});
  const check=new DatabaseSync(f.file);try{
   const columns=check.prepare('PRAGMA table_info(loop_native_attempts)').all() as {name:string;notnull:number}[];
   expect(columns.find(c=>c.name==='enrollment_request_id')?.notnull).toBe(0);
   expect(columns.some(c=>c.name==='kind')).toBe(true);
   expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   expect(check.prepare('SELECT * FROM native_migration_child').all()).toEqual([{id:'child',attempt_id:old.attemptId}]);
   expect(()=>check.prepare('INSERT INTO loop_native_attempts SELECT * FROM loop_native_attempts').run()).toThrow();
  }finally{check.close();}
 }finally{reopened.close();}
 }finally{if(!closed)f.store.close();rmSync(f.root,{recursive:true,force:true});}});
it('rejects raw caller manufactured reauthorization ticket without creating any new request',()=>{const f=fixture();try{
 let row=reserve(f);for(const phase of ['enrolling','enrolled','binding','needs_reauthorization'] as const)row=f.store.advanceLoopNativeAttempt({attemptId:row.attemptId,expectedRevision:row.revision,phase,requestSource:'user',now:20+row.revision});
 expect(typeof (f.store as any).applyLoopNativeReauthorization).toBe('function');
 expect(()=>(f.store as any).applyLoopNativeReauthorization({attemptId:row.attemptId,requestSource:'user',observation:{state:'reauthorization_required'}})).toThrow();
 expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual([row]);
 }finally{f.close();}});
it.each(['reserve','advance'] as const)('rolls back actual version-tail trigger changing native immutable request: %s',action=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const row=action==='advance'?reserve(f):undefined,before=f.store.listLoopNativeAttempts(f.candidate.candidateId),version=f.store.getAutomationStoreVersion();
 db.exec("CREATE TRIGGER native_version_tail AFTER UPDATE ON automation_store_metadata BEGIN UPDATE loop_native_attempts SET application_request_id='changed-at-version-tail'; END");
 expect(()=>action==='reserve'?reserve(f):f.store.advanceLoopNativeAttempt({attemptId:row!.attemptId,expectedRevision:row!.revision,phase:'enrolling',requestSource:'user',now:21})).toThrow();
 expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toEqual(before);expect(f.store.getAutomationStoreVersion()).toBe(version);
 }finally{db.close();f.close();}});
