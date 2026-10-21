import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalVerificationJson as canonical} from '../../../src/runtime/verification/protocol.js';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../../desktop/electron/loop-store.js';
import {CompletionEvidenceStore} from '../../../desktop/electron/completion-evidence-store.js';
import {ArtifactEvidenceRegressionScanner} from '../../../desktop/electron/artifact-evidence-regression-loop.js';
import {KSwarmServiceHealthScanner} from '../../../desktop/electron/kswarm-health-loop.js';
import {createLoopDatabaseOwnerGroup} from '../../../desktop/electron/loop-database-owner.js';
import {startProfileSourceCapture,readProfileSourceCapture} from '../../../src/runtime/verification/profile-source-capture.js';
import {loopPublicationFixture,readyLoopNative} from '../../../desktop/tests/support/loop-publication-fixture.js';
const publicationWire=vi.hoisted(()=>({routes:new Map<string,any>(),applications:new Map<string,any>(),publications:new Map<string,any>()}));
const completionWire=vi.hoisted(()=>({mode:'ordinary',taskId:''}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:{ownerKind:string;ownerId:string})=>publicationWire.routes.get(owner.ownerId)??(completionWire.mode==='ordinary'||owner.ownerId!==completionWire.taskId?{kind:'ordinary'}:completionWire.mode==='unavailable'?{kind:'unavailable'}:{kind:'protected',owner:{profileId:'historical-profile',...owner}})}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>{const call=(method:string)=>method==='completion.open-owner'?{owner:{profileId:'historical-profile',ownerKind:'task',ownerId:completionWire.taskId},readGrant:{id:'original-read',secret:'a'.repeat(64)}}:{owner:{profileId:'historical-profile',ownerKind:'task',ownerId:completionWire.taskId},migrationEpoch:1,businessRevision:1,obligationSetRevision:1,obligationSetHash:'b'.repeat(64),obligationCount:1,currentVerification:'valid'};return{completionTransport:{call:async(method:string)=>call(method),callSync:call},dispose(){}};}}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js',()=>({createInstalledLoopApplicationClient:(binding:any)=>({async inspect(){return{state:'active',current:publicationWire.applications.get(binding.candidateId),pendingTransitionId:null,pendingTarget:null};},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js',()=>({createInstalledCompletionPublisher:(owner:any)=>({async prepareRequest(){return publicationWire.publications.get(owner.ownerId).challenge;},async approve(){return publicationWire.publications.get(owner.ownerId).observation;},dispose(){}})}));
vi.mock('../../../src/runtime/loop/published-candidate.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-candidate.js')>(),readCurrentLoopPublishedCandidate:async(binding:any)=>{const value=[...publicationWire.publications.values()].find(value=>value.binding.candidateId===binding.candidateId);return{...value.observation,binding,application:publicationWire.applications.get(binding.candidateId),payloadHash:'a'.repeat(64),bytes:Buffer.from('original publication transport fixture')};}}));
vi.mock('../../../src/runtime/loop/published-set.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-set.js')>(),readCurrentLoopPublicationSet:async(bindings:any[])=>({clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'a'.repeat(64)},publications:bindings.map(binding=>{const publication=[...publicationWire.publications.values()].find(value=>value.binding.candidateId===binding.candidateId),{owner,businessRevision,operationId,fullTupleHash}=publication.observation;return{owner,businessRevision,operationId,fullTupleHash,application:publicationWire.applications.get(binding.candidateId)};})})}));
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-sqlite-loops-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
const closes:Array<()=>unknown>=[];
afterEach(async()=>{publicationWire.routes.clear();publicationWire.applications.clear();publicationWire.publications.clear();completionWire.mode='ordinary';completionWire.taskId='';for(const close of closes.splice(0).reverse())await close();});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
beforeAll(()=>{
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');
 execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
},40000);

let serial=0;
function fixture(split=false){
 const paths=[join(root,`loop-${serial++}.sqlite`)];if(split)paths.push(join(root,`completion-${serial++}.sqlite`));
 const group=createLoopDatabaseOwnerGroup(paths),loop=new LoopStore(group.sources[0]!),completion=new CompletionEvidenceStore(group.sources.at(-1)!),artifact=new ArtifactEvidenceRegressionScanner(group.sources.at(-1)!),health=new KSwarmServiceHealthScanner(group.sources.at(-1)!,{probe:async()=>({})} as never);
 try{
  completion.upsertExpectation({id:'expectation',ownerKind:'task',ownerId:'original-task',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1});
  completion.insertEvidence({id:'answer',ownerKind:'task',ownerId:'original-task',kind:'answer',summary:'Original retained answer',metadata:{responseId:'response-original'},now:2});
  completion.completeOwnerWithEvidence({ownerKind:'task',ownerId:'original-task',recordId:'completed-record',now:3});
  completion.markEvidenceOrphaned('answer',4);
  expect(()=>completion.completeOwnerWithEvidence({ownerKind:'task',ownerId:'missing-expectation',recordId:'failed-record',now:5})).toThrow();
 }finally{health.close();artifact.close();completion.close();loop.close();group.close();}
 return paths;
}
function change(path:string,sql:string){const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=OFF');db.exec(sql);}finally{db.close();}}
async function captured(paths:string[]){
 const sources=paths.map((path,index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return{sourceId:`source-${index}`,kind:'sqlite-db' as const,snapshotFormat:'loop-sqlite-v1' as const,directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});closes.push(()=>owner.close());return{owner,token:await owner.capture()};
}
it.each([false,true])('retains all actual constructors and nullable failed completion history, split=%s',async split=>{
 const paths=fixture(split),{owner,token}=await captured(paths),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');
 const before=readProfileSourceCapture(owner,token),facts=readCapturedSQLiteLoopSources(owner,token);
 expect(facts.kind).toBe('captured-loop-sqlite-declarations');expect(facts.sources).toHaveLength(paths.length);
 const source=facts.sources.at(-1)!;expect(source.tables.completion_records).toHaveLength(2);expect(source.tables.completion_records.find(row=>row.id==='failed-record')).toMatchObject({expectation_id:null,ok:0});
 expect(source.tables.completion_evidence).toMatchObject([{id:'answer',orphaned_at:4}]);
 expect(Object.keys(facts.sources[0]!.tables)).toHaveLength(split?23:27);expect(source.snapshotHash).toBe(before.sources.at(-1)!.snapshotHash);expect(Object.isFrozen(source.tables.completion_records[0])).toBe(true);
 expect(()=>readCapturedSQLiteLoopSources({...owner},token)).toThrow('brand');expect(()=>readCapturedSQLiteLoopSources(owner,{...token})).toThrow('brand');await owner.checkCurrent();
});
it.each([
 ['unknown-table','CREATE TABLE unlisted(payload TEXT)'],
 ['missing-trigger','DROP TRIGGER loop_artifact_export_no_delete'],
 ['different-index','DROP INDEX idx_loop_definitions_status;CREATE INDEX idx_loop_definitions_status ON loop_definitions(title)'],
 ['expectation-orphan',"UPDATE completion_records SET expectation_id='missing' WHERE id='completed-record'"],
 ['evidence-orphan',`UPDATE completion_records SET evidence_ids_json='["missing"]' WHERE id='completed-record'`],
 ['duplicate-json',`UPDATE completion_evidence SET metadata_json='{"taskId":"one","taskId":"two"}'`],
] as const)('refuses a captured inconsistency without dropping its table or row: %s',async(_name,sql)=>{
 const paths=fixture();change(paths[0]!,sql);const{owner,token}=await captured(paths),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');
 expect(typeof readCapturedSQLiteLoopSources).toBe('function');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();
});

function nativeFixture(){
 const f=loopPublicationFixture();const native=readyLoopNative(f);
 const publication=f.store.reserveLoopPublicationAttempt({nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30});
 const session=f.store.reserveLoopVerificationSession({nativeAttemptId:native.attemptId,obligationId:'run-original',sessionId:'actual-verification-session',requestSource:'user',now:31});
 const path=join(root,`native-${serial++}.sqlite`);try{f.store.close();copyFileSync(f.file,path);}finally{f.close();}return{path,native,publication,session};
}
it('retains the original actual native candidate, publication and verification-session chain',async()=>{
 const f=nativeFixture(),{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');
 const result=readCapturedSQLiteLoopSources(owner,token).sources[0]!;
 expect(result.tables.loop_publication_candidates).toHaveLength(2);expect(result.tables.loop_publication_attempts).toHaveLength(1);
 expect(result.references).toContainEqual({namespace:'session',relation:'loop_verification_sessions.session',id:f.session.sessionId,record:f.session.id});
});
it.each([
 ['native-binding',"UPDATE loop_native_attempts SET binding_hash='"+'b'.repeat(64)+"'"],
 ['native-ordinal','UPDATE loop_native_attempts SET ordinal=2'],
 ['native-candidate',"UPDATE loop_native_attempts SET candidate_id='missing'"],
 ['session-obligation',"UPDATE loop_verification_sessions SET obligation_id='missing'"],
 ['session-revision','UPDATE loop_verification_sessions SET revision=7'],
 ['publication-projection','UPDATE loop_publication_attempts SET sequence=2'],
 ['basis-hash',"UPDATE loop_run_publication_basis SET basis_hash='"+'c'.repeat(64)+"'"],
 ['candidate-binding',"UPDATE loop_publication_candidates SET binding_hash='"+'c'.repeat(64)+"'"],
] as const)('rejects an actual captured native historical inconsistency: %s',async(_name,sql)=>{
 const f=nativeFixture();change(f.path,sql);const{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();
});

function scannerFixture(){const paths=fixture(),path=paths[0]!,completion=new CompletionEvidenceStore(path),artifact=new ArtifactEvidenceRegressionScanner(path),health=new KSwarmServiceHealthScanner(path,{probe(){throw Error('original source unavailable');}});
 try{completion.upsertExpectation({id:'bad-expectation',ownerKind:'task',ownerId:'bad-answer-owner',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:7});completion.insertEvidence({id:'bad-answer-evidence',ownerKind:'task',ownerId:'bad-answer-owner',kind:'answer',summary:'No response identity',now:8});expect(()=>completion.completeOwnerWithEvidence({ownerKind:'task',ownerId:'bad-answer-owner',recordId:'bad-answer-record',now:9})).toThrow();artifact.scan({loopRunId:'artifact-scan-run',now:10});health.scan({loopRunId:'health-scan-run',now:11});}finally{health.close();artifact.close();completion.close();}return path;}
it('captures both actual scanners sharing one anomaly table and retains original same-source evidence',async()=>{
 const path=scannerFixture(),{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;
 expect(new Set(source.tables.evidence_anomalies.map(row=>row.loop_id))).toEqual(new Set(['artifact-evidence-regression','kswarm-service-health']));expect(source.references.some(ref=>ref.namespace==='completion-evidence'&&ref.id==='bad-answer-evidence'&&ref.relation==='evidence_anomalies.evidence')).toBe(true);
});
it.each([
 ['unknown-kind',"UPDATE evidence_anomalies SET kind='unknown'"],
 ['missing-evidence',`UPDATE evidence_anomalies SET evidence_ids_json='["missing"]' WHERE loop_id='artifact-evidence-regression'`],
 ['missing-record',`UPDATE evidence_anomalies SET metadata_json=json_set(metadata_json,'$.completionRecordId','missing') WHERE loop_id='artifact-evidence-regression'`],
 ['crossed-owner',`UPDATE evidence_anomalies SET evidence_ids_json='["bad-answer-evidence"]' WHERE owner_id='original-task'`],
 ['health-evidence',`UPDATE evidence_anomalies SET evidence_ids_json='["answer"]' WHERE loop_id='kswarm-service-health'`],
] as const)('rejects actual scanner retained relationship corruption: %s',async(_name,sql)=>{const path=scannerFixture();change(path,sql);const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});
it.each([
 ['producer-hash',"UPDATE loop_producer_results SET body_hash='"+'b'.repeat(64)+"'"],
 ['producer-identity',"UPDATE loop_producer_results SET revision=2"],
 ['source-vector',"UPDATE loop_publication_candidates SET source_vector_hash='"+'b'.repeat(64)+"';UPDATE loop_native_attempts SET source_vector_hash='"+'b'.repeat(64)+"'"],
 ['source-basis-nested',"UPDATE loop_run_publication_basis SET basis_json=json_set(basis_json,'$.sourceRows.run.trigger_json','{\"kind\":\"manual\",\"kind\":\"manual\"}')"],
] as const)('rejects original result/source basis inconsistency: %s',async(_name,sql)=>{
 const f=nativeFixture();change(f.path,sql);const{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();
});

async function taskFixture(mode:string,terminal=false,repeatedEvidence=false){
 const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js'),{FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js'),{InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 let time=10;const taskRoot=join(root,`task-${serial++}`),snapshotStore=new FileTaskSnapshotStore(join(taskRoot,'snapshots'));
 const host=new InProcessTaskRuntimeHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(taskRoot,'workspace'),maxBytes:1024*1024}),snapshotStore,now:()=>time++,runner:async()=>undefined});
 const created=await host.createTask({prompt:'Original actual task',materials:[]});await host.drain();
 completionWire.taskId=created.taskId;completionWire.mode=mode;const snapshot=(await host.inspectTask(created.taskId))!;expect(snapshot.status).toBe('completed');expect(snapshot.currentCompletion?.kind).toBe(mode);
 const path=join(root,`execution-${serial++}.sqlite`),store=new LoopStore(path),loopId='actual-template';
 try{const definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
  store.createUserLoopTemplate({loopId,kind:'task_completion',title:'Actual template',prompt:'Original actual task',now:1});store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:definition,stages:{execute:definition,verify:definition}}}});
  const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');const producer=store.openLoopPublicationProducer(began.run),execute=store.startLoopStage(began.run.id,loopId,'execute',4,{taskId:created.taskId});
  producer.recordTemplateExecution({executeStageId:execute.id,taskSnapshot:snapshot,summary:'Original TaskHost result',evidenceIds:[],artifacts:[],now:time++});if(terminal){const verify=store.startLoopStage(began.run.id,loopId,'verify',time++,{taskId:created.taskId});producer.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'Original verified terminal',evidenceIds:repeatedEvidence?['original-evidence','original-evidence']:['original-evidence'],artifacts:[],now:time++});}else store.recoverLoopPublicationCandidates({runId:began.run.id,requestSource:'user'});
 }finally{store.close();await host.closeSourceWriterForMigration();}
 return{path,snapshot};
}
it.each(['unavailable','protected'])('preserves original TaskHost observation and complete captured task declarations: %s',async mode=>{
 const f=await taskFixture(mode),{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;
 expect(source.embeddedTasks).toMatchObject([{declaration:{taskId:f.snapshot.taskId,sessionIdentities:[f.snapshot.sessionId]},completionObservation:f.snapshot.currentCompletion}]);
 expect(source.references.some(ref=>ref.namespace==='session'&&ref.id===f.snapshot.sessionId)).toBe(true);
});

function exportFixture(){
 const template=loopPublicationFixture(),configuration=template.store.getLoopPublicationConfiguration(template.loopId)!.configuration;template.close();
 const path=join(root,`exports-${serial++}.sqlite`),store=new LoopStore(path),loopId='artifact-evidence-regression',descriptor={selection:{kind:'local' as const,obligationId:'run-original',path:'report'},sha256:'a'.repeat(64),size:12};
 try{store.ensureBuiltInLoops(1);store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration});const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');const stage=store.startLoopStage(began.run.id,loopId,'scan',4),producer=store.openLoopPublicationProducer(began.run),evidencePath=join(root,`export-evidence-${serial++}.sqlite`),evidence=new CompletionEvidenceStore(evidencePath),scanner=new ArtifactEvidenceRegressionScanner(evidencePath);
  try{producer.recordScan(stage.id,scanner.scan({loopRunId:began.run.id,now:10}),10,[descriptor]);}finally{scanner.close();evidence.close();}
  const candidate=store.recoverLoopPublicationCandidates({runId:began.run.id,requestSource:'user'}).find(value=>value.stageId===null)!;
  for(let i=0;i<2;i++){const id=randomUUID();store.prepareLoopArtifactExport({id,requestSource:'user',now:20+i,source:{loopId,runId:began.run.id,candidateId:candidate.candidateId,candidateRevision:candidate.binding.candidateRevision,payloadHash:'b'.repeat(64),vectorHash:'c'.repeat(64),descriptor},destination:{parent:root,parentIdentity:{device:'1',inode:'2'},temporaryName:'.xiaok-export-'+id,targetName:`result-${i}`,ownershipToken:'d'.repeat(64)}});if(i===0)store.recordLoopArtifactExport({id,requestSource:'user',expectedRevision:1,now:30,event:{kind:'interrupted'}});}
 }finally{store.close();}return path;
}
it('retains all actual export journal progress including unknown and its original sequence high water',async()=>{const path=exportFixture(),{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.tables.loop_artifact_exports).toHaveLength(2);expect(source.json.loop_artifact_exports.map(row=>(row.record_json as {state:string}).state)).toEqual(['unknown','pending']);expect(source.references.filter(ref=>ref.relation==='loop_artifact_exports.candidate')).toHaveLength(2);});
it.each(['record-hash','sequence-high-water','foreign-candidate','changed-descriptor'])('rejects actual export capture inconsistency: %s',async mode=>{
 const path=exportFixture(),db=new DatabaseSync(path);try{if(mode==='record-hash')db.exec("UPDATE loop_artifact_exports SET record_hash='"+'f'.repeat(64)+"'");else if(mode==='sequence-high-water')db.exec("UPDATE sqlite_sequence SET seq=1 WHERE name='loop_artifact_exports'");else{const row=db.prepare('SELECT * FROM loop_artifact_exports LIMIT 1').get()!,record=JSON.parse(String(row.record_json));if(mode==='foreign-candidate')record.source.candidateId='missing';else record.source.descriptor.sha256='f'.repeat(64);const encoded=canonical(record),hash=createHash('sha256').update('xiaok-loop-artifact-export-v1\0').update(encoded).digest('hex');db.prepare('UPDATE loop_artifact_exports SET record_json=?,record_hash=? WHERE id=?').run(encoded,hash,row.id);}}finally{db.close();}
 const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();
});

async function promotionFixture(unknown=false){
 const {createLoopBusinessPublicationHost}=await import('../../../desktop/electron/loop-business-publication-host.js');const path=join(root,`promotion-${serial++}.sqlite`),store=new LoopStore(path),loopId='personal-assistant-evening-reflection';store.ensureBuiltInLoops(1);store.setLoopStatus(loopId,'active',2);const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');
 const[member]=store.stageAssistantCandidates(began.run.id,[{kind:'memory',title:'Original memory',content:'Original body',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'actual-original-task'}],dedupeKey:'original'}],4);store.finishAssistantLoopRunSuccess(began.run.id,[],5,'original');
 const host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>10,assistantTargets:{async ensureMemory(){if(unknown)throw Error('original target unconfirmed');return{targetRef:'memory://original'};},async ensureKnowledge(){throw Error('unexpected');},async ensureFollowUp(){throw Error('unexpected');}}});
 try{const result=host.acceptAssistantCandidate({candidateId:member!.id,requestSource:'user'});if(unknown)await expect(result).rejects.toThrow('original target unconfirmed');else expect((await result).status).toBe('accepted');}finally{await host.close();store.close();}return path;
}
it.each([false,true])('retains actual original Main assistant promotion, target unconfirmed=%s',async unknown=>{const path=await promotionFixture(unknown),{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.json.assistant_promotion_intents[0]!.record_json).toMatchObject({state:unknown?'accepting':'accepted'});expect(source.references.filter(ref=>ref.relation==='assistant_promotion_intents.target')).toHaveLength(1);});
it.each(['projection','target','member-content'])('rejects actual promotion capture mismatch: %s',async mode=>{const path=await promotionFixture(),db=new DatabaseSync(path);try{if(mode==='projection')db.exec('UPDATE assistant_promotion_intents SET revision=1');else if(mode==='member-content')db.exec("UPDATE assistant_candidates SET content='replaced'");else{const row=db.prepare('SELECT * FROM assistant_promotion_intents').get()!,value=JSON.parse(String(row.record_json));value.target.targetId='foreign';db.prepare('UPDATE assistant_promotion_intents SET record_json=?').run(canonical(value));}}finally{db.close();}const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});

async function projectionFixture(){
 const {createLoopPublicationWorkflow}=await import('../../../desktop/electron/loop-publication-workflow.js'),{createLoopBusinessPublicationHost}=await import('../../../desktop/electron/loop-business-publication-host.js'),{loopHostSubjectOwner}=await import('../../../src/runtime/verification/loop-host-subject.js');
 const f=loopPublicationFixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>100}),workflow=createLoopPublicationWorkflow({store:f.store,assertAdmission(){},now:()=>40}),path=join(root,`projection-${serial++}.sqlite`);
 try{for(const candidate of [f.candidate,f.scanCandidate]){const native=readyLoopNative({store:f.store,candidate}),owner={profileId:'historical-loop-profile',...loopHostSubjectOwner(candidate.binding.subject)},application={binding:candidate.binding,bindingHash:candidate.bindingHash,revision:1};publicationWire.routes.set(owner.ownerId,{kind:'protected-unregistered',authorityId:'original-authority',owner});publicationWire.applications.set(candidate.candidateId,application);publicationWire.publications.set(owner.ownerId,{binding:candidate.binding,challenge:{challengeId:'challenge-'+candidate.candidateId,owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}},observation:{owner,status:'committed',operationId:'operation-'+candidate.candidateId,fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'}});await workflow.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user'});}
  expect((await host.project({runId:f.candidate.runId,requestSource:'user'})).generation).toBe(1);
  const old=f.store.listLoopPublicationAttempts(f.candidate.candidateId).at(-1)!;let native=f.store.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId:old.nativeAttemptId,requestSource:'user',now:120});for(const phase of ['enrolling','enrolled','binding','ready'] as const)native=f.store.advanceLoopNativeAttempt({attemptId:native.attemptId,expectedRevision:native.revision,phase,requestSource:'user',now:120+native.revision});const publication=publicationWire.publications.get(loopHostSubjectOwner(f.candidate.binding.subject).ownerId)!;publication.challenge={...publication.challenge,challengeId:'second',fullTupleHash:'b'.repeat(64)};publication.observation={...publication.observation,operationId:'second',fullTupleHash:'b'.repeat(64),businessRevision:2};const next=createLoopPublicationWorkflow({store:f.store,assertAdmission(){},now:()=>150});try{await next.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:old.attemptId,requestSource:'user'});}finally{await next.close();}
  expect((await host.project({runId:f.candidate.runId,requestSource:'user'})).generation).toBe(2);
 }finally{await workflow.close();await host.close();f.store.close();copyFileSync(f.file,path);f.close();}return path;
}
it('retains both actual original business projection generations and their publication chains',async()=>{const path=await projectionFixture(),{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.tables.loop_projection_generations).toHaveLength(2);expect(source.tables.loop_publication_attempts).toHaveLength(3);});
it.each(['owner','application','clock','origin','current-row'])('rejects hash-consistent changed historical projection: %s',async mode=>{const path=await projectionFixture(),db=new DatabaseSync(path);try{if(mode==='current-row'){db.exec("UPDATE loop_runs SET summary='different current row'");}else{const table=mode==='origin'?'loop_projection_origins':'loop_projection_generations',row=db.prepare('SELECT * FROM '+table+' ORDER BY rowid DESC LIMIT 1').get()!,value=JSON.parse(String(row.record_json));if(mode==='owner')value.observation.publications[0].owner.ownerId='other';else if(mode==='application')value.observation.publications[0].application.bindingHash='f'.repeat(64);else if(mode==='clock')value.observation.clock.upperBound=-1;else value.after.run.summary='changed';const {loopProjectionHash}=await import('../../../src/runtime/loop/business-projection.js');db.prepare('UPDATE '+table+' SET record_json=?,'+(mode==='origin'?'origin_hash':'generation_hash')+'=? WHERE rowid=(SELECT MAX(rowid) FROM '+table+')').run(canonical(value),loopProjectionHash(value));}}finally{db.close();}const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});

it.each(['task-owner','completion-shape','nested-duplicate'])('rejects changed original embedded Task after recomputing only its outer hash: %s',async mode=>{const f=await taskFixture('protected'),db=new DatabaseSync(f.path);try{const row=db.prepare('SELECT * FROM loop_stage_execution_results').get()!,snapshot=JSON.parse(String(row.task_snapshot_json));if(mode==='task-owner')snapshot.currentCompletion.state.owner.ownerId='foreign-task';else if(mode==='completion-shape')snapshot.currentCompletion.state=[];let encoded=canonical(snapshot);if(mode==='nested-duplicate')encoded=encoded.replace('"migrationEpoch":1','"migrationEpoch":1,"migrationEpoch":1');const hash=createHash('sha256').update('xiaok-loop-run-publication-basis-v1\0').update(encoded).digest('hex');db.prepare('UPDATE loop_stage_execution_results SET task_snapshot_json=?,task_snapshot_hash=?').run(encoded,hash);}finally{db.close();}const{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});

function executionFixture(){const f=loopPublicationFixture(),native=readyLoopNative(f);let session=f.store.reserveLoopVerificationSession({nativeAttemptId:native.attemptId,obligationId:'run-original',sessionId:'original-material-session',requestSource:'user',now:30});session=f.store.acknowledgeLoopVerificationSession({id:session.id,expectedRevision:session.revision,requestSource:'scheduler',now:31});for(const phase of ['enrolling','enrolled'] as const)session=f.store.advanceLoopVerificationEnrollment({id:session.id,expectedRevision:session.revision,phase,requestSource:'user',now:32});const execution=f.store.reserveLoopVerificationExecution({sessionRecordId:session.id,exactCommand:{argv:['node','verify.cjs'],cwdRelative:'.'},expiresAt:10000,requestSource:'user',now:40}),path=join(root,`verification-${serial++}.sqlite`);try{f.store.close();copyFileSync(f.file,path);}finally{f.close();}return{path,execution};}
it('retains actual verification execution requests separately from its session identity',async()=>{const f=executionFixture(),{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.tables.loop_verification_executions).toHaveLength(1);expect(source.references).toContainEqual({namespace:'material-request',id:f.execution.materialRequestId,relation:'loop_verification_executions.material_request',record:f.execution.id});});
it.each(['session','invocation','revision'])('rejects altered verification execution capture: %s',async mode=>{const f=executionFixture(),db=new DatabaseSync(f.path);try{const row=db.prepare('SELECT * FROM loop_verification_executions').get()!,value=JSON.parse(String(row.record_json));if(mode==='session')value.sessionRecordId='foreign';else if(mode==='invocation')value.invocation.sessionIdentity='foreign';else value.revision=0;db.prepare('UPDATE loop_verification_executions SET record_json=?').run(canonical(value));}finally{db.close();}const{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});

function constraintFixture(clear=false){const path=join(root,`constraints-${serial++}.sqlite`),store=new LoopStore(path),loopId='artifact-evidence-regression';try{store.ensureBuiltInLoops(1);const began=store.beginLoopRun(loopId,{kind:'manual'},2,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');const input={loopId,source:'user_manual' as const,rule:'Original rule',sourceRunId:began.run.id,failureKind:'executor_failed',failureReason:'original reason',now:3};const first=store.addConstraint(input),second=store.addConstraint({...input,rule:'Replacement rule',now:4});store.startLoopStage(began.run.id,loopId,'execute',5,{taskId:'external-original-task',injectedConstraintIds:[first.id,second.id]});if(clear)store.clearLoopRunHistory(loopId);return{path,first,second,runId:began.run.id};}finally{store.close();}}
it.each([false,true])('retains original supersession and soft historical run after clear=%s',async clear=>{const f=constraintFixture(clear),{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.tables.loop_learned_constraints).toHaveLength(2);expect(source.references.filter(ref=>ref.id===f.runId&&ref.relation==='loop_learned_constraints.source_run')).toHaveLength(2);expect(source.tables.loop_runs).toHaveLength(clear?0:1);if(!clear){expect(source.references.some(ref=>ref.namespace==='task'&&ref.id==='external-original-task')).toBe(true);expect(source.references.filter(ref=>ref.namespace==='loop-constraint')).toHaveLength(2);}});
it.each(['missing','cycle','source'])('rejects original constraint inconsistency: %s',async mode=>{const f=constraintFixture();change(f.path,mode==='missing'?"UPDATE loop_learned_constraints SET superseded_by='missing'":mode==='cycle'?"UPDATE loop_learned_constraints SET superseded_by=id":"UPDATE loop_learned_constraints SET source='invented'");const{owner,token}=await captured([f.path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(()=>readCapturedSQLiteLoopSources(owner,token)).toThrow();});
it('accepts all three original legacy table layouts after the actual constructor ADD COLUMN migrations',async()=>{const fresh=join(root,`migration-reference-${serial++}.sqlite`),first=new LoopStore(fresh);first.close();const reference=new DatabaseSync(fresh),path=join(root,`migration-old-${serial++}.sqlite`),db=new DatabaseSync(path);try{for(const [table,columns]of [['loop_definitions',['origin','deleted_at','delete_reason']],['loop_runs',['duration_ms','logical_run_key']],['user_loop_templates',['contract_json','contract_schema_version']]] as const){let sql=String(reference.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table)!.sql);for(const column of columns)sql=sql.replace(new RegExp('^\\s*'+column+'[^\\n]*,?\\s*$','m'),'');sql=sql.replace(/,\s*\)/,')');db.exec(sql);}}finally{db.close();reference.close();}const migrated=new LoopStore(path);try{migrated.ensureBuiltInLoops(1);}finally{migrated.close();}const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(Object.keys(readCapturedSQLiteLoopSources(owner,token).sources[0]!.tables)).toHaveLength(23);});

it('preserves finite fractional ordinary producer values despite SQLite INTEGER affinity',async()=>{const path=join(root,`fractional-${serial++}.sqlite`),store=new LoopStore(path),completion=new CompletionEvidenceStore(path);try{store.ensureBuiltInLoops(0.25);const began=store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},1.25,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');store.finishLoopRunWithDuration(began.run.id,0.5);completion.upsertExpectation({id:'fractional-time',ownerKind:'task',ownerId:'fractional-owner',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1.25});completion.upsertExpectation({id:'fractional-time',ownerKind:'task',ownerId:'fractional-owner',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:0.75});completion.insertEvidence({id:'fractional-evidence',ownerKind:'task',ownerId:'fractional-owner',kind:'answer',summary:'actual ordinary evidence',metadata:{responseId:'actual'},now:2.25});completion.completeOwnerWithEvidence({ownerKind:'task',ownerId:'fractional-owner',recordId:'fractional-record',now:3.25});}finally{completion.close();store.close();}const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');const source=readCapturedSQLiteLoopSources(owner,token).sources[0]!;expect(source.tables.loop_runs[0]!.duration_ms).toBe(0.5);expect(source.tables.completion_expectations[0]).toMatchObject({created_at:1.25,updated_at:0.75});expect(source.tables.completion_records[0]!.created_at).toBe(3.25);});

it('streams every actual source row and seals completion only after all original sources are consumed',async()=>{
 const paths=fixture(true),{owner,token}=await captured(paths);
 const module=await import('../../support/captured-loop-stream-collector.js');
 const stream=(module as unknown as {iterateCapturedSQLiteLoopSources:(owner:object,token:object)=>IterableIterator<any>}).iterateCapturedSQLiteLoopSources;
 expect(typeof stream).toBe('function');
 const expected=paths.map(path=>{const db=new DatabaseSync(path);try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>({table:String(row.name),count:Number(db.prepare(`SELECT COUNT(*) AS count FROM "${row.name}"`).get()!.count)}));}finally{db.close();}});
 const capture=readProfileSourceCapture(owner,token),events=[...stream(owner,token)];
 expect(events.at(-1)).toMatchObject({kind:'complete'});
 expect(events.filter(event=>event.kind==='source-start')).toHaveLength(2);
 for(let index=0;index<capture.sources.length;index++)for(const table of expected[index]!){const rows=events.filter(event=>event.kind==='row'&&event.sourceId===capture.sources[index]!.source.sourceId&&event.table===table.table);expect(rows).toHaveLength(table.count);}
 expect(events.filter(event=>event.kind==='complete')).toHaveLength(1);
 const firstDigest=events.at(-1).digest;
 expect(firstDigest).toMatch(/^[a-f0-9]{64}$/);
 expect([...stream(owner,token)].at(-1).digest).toBe(firstDigest);
 const abandoned=stream(owner,token);while(true){const step=abandoned.next();if(step.done)throw Error('missing row');if(step.value.kind==='row')break;}abandoned.return?.();
 expect([...stream(owner,token)].at(-1).digest).toBe(firstDigest);
});
it('decodes actual lossless SQLite ordinary values before any Number conversion',async()=>{
 const paths=fixture(),db=new DatabaseSync(paths[0]!);try{db.exec("UPDATE completion_expectations SET created_at=9007199254740993,updated_at=0.75");}finally{db.close();}
 const{owner,token}=await captured(paths),capture=await import('../../../src/runtime/verification/profile-source-capture.js');
 const values=await import('../../../src/runtime/verification/captured-sqlite-loop-values.js');
 const reader=capture.openProfileSqliteReader(owner,token,'source-0');try{
  const rows=[...capture.iterateProfileSqliteReaderRows(reader,'completion:completion_expectations')];
  const row=values.decodeCapturedLoopRow('completion_expectations',rows[0]!.record);
  expect(row.created_at).toBe(9007199254740993n);expect(row.updated_at).toBe(0.75);
  expect(rows[0]!.record.created_at).toEqual({type:'integer',value:'9007199254740993'});
 }finally{capture.closeProfileSqliteReader(reader);}
});
it.each([
 ['unsafe protocol integer','UPDATE completion_expectations SET schema_version=9007199254740993','completion:completion_expectations','completion_expectations'],
 ['fractional protocol integer','UPDATE completion_expectations SET schema_version=1.5','completion:completion_expectations','completion_expectations'],
 ['nonfinite ordinary real','UPDATE completion_expectations SET updated_at=1e999','completion:completion_expectations','completion_expectations'],
 ['ordinary blob',"UPDATE completion_expectations SET updated_at=x'00'",'completion:completion_expectations','completion_expectations'],
] as const)('rejects exact original storage mismatch without numeric rounding: %s',async(_name,sql,query,table)=>{
 const paths=fixture();change(paths[0]!,sql);const{owner,token}=await captured(paths),capture=await import('../../../src/runtime/verification/profile-source-capture.js'),values=await import('../../../src/runtime/verification/captured-sqlite-loop-values.js');const reader=capture.openProfileSqliteReader(owner,token,'source-0');try{const rows=[...capture.iterateProfileSqliteReaderRows(reader,query)];expect(()=>values.decodeCapturedLoopRow(table,rows[0]!.record)).toThrow();}finally{capture.closeProfileSqliteReader(reader);}
});
it('uses the same actual parser copy for a semantic full row and exact relation lookup',async()=>{
 const paths=fixture(),{owner,token}=await captured(paths);
 const{CapturedLoopSourceReader}=await import('../../../src/runtime/verification/captured-sqlite-loop-reader.js');
 const reader=new CapturedLoopSourceReader(owner,token,'source-0');
 try{let count=0;for(const row of reader.rows('completion_expectations')){count++;const same=reader.one('loop:expectation',row.value.id)!;expect(same.cells).toEqual(row.cells);expect(same.rowid).toBe(row.rowid);}expect(count).toBe(1);expect(reader.one('loop:expectation','not-present',false)).toBeUndefined();expect(()=>reader.one('loop:expectation','not-present')).toThrow('orphan');}
 finally{reader.close();}
 const next=new CapturedLoopSourceReader(owner,token,'source-0');next.close();
});
it('validates actual ordinary rows with fixed relationships without retaining all tables',async()=>{
 const f=constraintFixture(),{owner,token}=await captured([f.path]);
 const{CapturedLoopSourceReader}=await import('../../../src/runtime/verification/captured-sqlite-loop-reader.js'),{validateCapturedLoopOrdinaryRow,validateCapturedLoopConstraintChains}=await import('../../../src/runtime/verification/captured-sqlite-loop-row-semantics.js');
 const reader=new CapturedLoopSourceReader(owner,token,'source-0');try{
  const refs=[];for(const table of reader.tables)for(const row of reader.rows(table))refs.push(...validateCapturedLoopOrdinaryRow(reader,row));
  validateCapturedLoopConstraintChains(reader);
  expect(refs.filter(ref=>ref.namespace==='loop-constraint')).toHaveLength(2);expect(refs.some(ref=>ref.namespace==='task'&&ref.id==='external-original-task')).toBe(true);
 }finally{reader.close();}
});
it.each(['missing','cycle','source'])('streaming ordinary pass preserves actual constraint rejection: %s',async mode=>{
 const f=constraintFixture();change(f.path,mode==='missing'?"UPDATE loop_learned_constraints SET superseded_by='missing'":mode==='cycle'?"UPDATE loop_learned_constraints SET superseded_by=id":"UPDATE loop_learned_constraints SET source='invented'");
 const{owner,token}=await captured([f.path]),{CapturedLoopSourceReader}=await import('../../../src/runtime/verification/captured-sqlite-loop-reader.js'),{validateCapturedLoopOrdinaryRow,validateCapturedLoopConstraintChains}=await import('../../../src/runtime/verification/captured-sqlite-loop-row-semantics.js');
 const reader=new CapturedLoopSourceReader(owner,token,'source-0');try{expect(()=>{for(const row of reader.rows('loop_learned_constraints'))validateCapturedLoopOrdinaryRow(reader,row);validateCapturedLoopConstraintChains(reader);}).toThrow();}finally{reader.close();}
});
it('validates actual native history through run-scoped same-copy relationships',async()=>{
 const f=nativeFixture(),{owner,token}=await captured([f.path]),{CapturedLoopSourceReader}=await import('../../../src/runtime/verification/captured-sqlite-loop-reader.js'),{validateCapturedLoopPublicationPass}=await import('../../../src/runtime/verification/captured-sqlite-loop-publication.js');const reader=new CapturedLoopSourceReader(owner,token,'source-0');try{validateCapturedLoopPublicationPass(reader);}finally{reader.close();}
});
it.each([
 ['native binding',"UPDATE loop_native_attempts SET binding_hash=replace(binding_hash,substr(binding_hash,1,1),'z')"],
 ['session obligation',"UPDATE loop_verification_sessions SET obligation_id='foreign'"],
 ['native ordinal',"UPDATE loop_native_attempts SET ordinal=2"],
 ['historical basis',"UPDATE loop_run_publication_basis SET basis_hash='bad'"],
] as const)('run-scoped native pass rejects original durable mismatch: %s',async(_name,sql)=>{
 const f=nativeFixture();change(f.path,sql);const{owner,token}=await captured([f.path]),{CapturedLoopSourceReader}=await import('../../../src/runtime/verification/captured-sqlite-loop-reader.js'),{validateCapturedLoopPublicationPass}=await import('../../../src/runtime/verification/captured-sqlite-loop-publication.js');const reader=new CapturedLoopSourceReader(owner,token,'source-0');try{expect(()=>validateCapturedLoopPublicationPass(reader)).toThrow();}finally{reader.close();}
});
it.each(['UTF-8','UTF-16le','UTF-16be'])('stream preserves original Unicode IDs and UTF-8 ordering in %s source',async encoding=>{
 const path=join(root,`unicode-${serial++}.sqlite`),seed=new DatabaseSync(path);seed.exec(`PRAGMA encoding='${encoding}'`);seed.close();
 const completion=new CompletionEvidenceStore(path),ids=['A','\ue000','\u{10000}','原始'];try{for(const id of ids)completion.upsertExpectation({id,ownerKind:'task',ownerId:'original-owner-'+id,expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1});}finally{completion.close();}
 const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');
 const events=[...iterateCapturedSQLiteLoopSources(owner,token)],actual=events.filter(e=>e.kind==='row'&&e.table==='completion_expectations').map(e=>e.kind==='row'&&e.cells.id.type==='text'?e.cells.id.value:'invalid');
 expect(actual).toEqual([...ids].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));expect(events.at(-1)?.kind).toBe('complete');
});
it('stream seals exact framed events and does not expose mutable parsed bodies',async()=>{
 const paths=fixture(),{owner,token}=await captured(paths),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const events=[...iterateCapturedSQLiteLoopSources(owner,token)],hash=createHash('sha256').update(Buffer.from('xiaok-captured-loop-declarations-v1\0'));
 for(const event of events){expect(Object.isFrozen(event)).toBe(true);if(event.kind==='complete')continue;const bytes=Buffer.from(canonical(event)),size=Buffer.alloc(8);size.writeBigUInt64BE(BigInt(bytes.length));hash.update(size).update(bytes);if(event.kind==='row'){expect(Object.isFrozen(event.cells)).toBe(true);expect(Object.isFrozen(event.parsed)).toBe(true);expect(Object.isFrozen(event.references)).toBe(true);}}
 const complete=events.at(-1)!;expect(complete.kind).toBe('complete');if(complete.kind!=='complete')throw Error('missing completion');expect(complete.digest).toBe(hash.digest('hex'));
});
it('actual owner close while a row is yielded prevents any final complete and releases the parser',async()=>{
 const paths=fixture(),{owner,token}=await captured(paths),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js'),iterator=iterateCapturedSQLiteLoopSources(owner,token);let last;
 do{last=iterator.next();if(last.done)throw Error('missing row');}while(last.value.kind!=='row');
 await owner.close();expect(()=>iterator.next()).toThrow();expect(iterator.next().done).toBe(true);
 expect(()=>[...iterateCapturedSQLiteLoopSources({...owner},token)]).toThrow();
});
it.each([
 ['trigger',`UPDATE loop_runs SET trigger_json='{"kind":"another-original-shape"}'`],
 ['logical key',"UPDATE loop_runs SET logical_run_key='different'"],
 ['start time','UPDATE loop_runs SET started_at=started_at+1'],
] as const)('rejects immutable current run drift from original retained basis: %s',async(_name,sql)=>{
 const f=nativeFixture();change(f.path,sql);const{owner,token}=await captured([f.path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();
});
it.each([false,true])('binds original template terminal evidence before any candidate exists, changed=%s',async changed=>{
 const f=await taskFixture('unavailable',true),db=new DatabaseSync(f.path);try{expect(db.prepare('SELECT COUNT(*) AS n FROM loop_publication_candidates').get()!.n).toBe(0);}finally{db.close();}
 if(changed)change(f.path,`UPDATE loop_producer_results SET evidence_ids_json='["replacement-evidence"]'`);
 const{owner,token}=await captured([f.path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');if(changed)expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();else expect([...iterateCapturedSQLiteLoopSources(owner,token)].at(-1)?.kind).toBe('complete');
});
it.each(['task','execute-stage'])('checks actual terminal Task binding before candidates, changed=%s',async changed=>{
 const f=await taskFixture('unavailable',true),db=new DatabaseSync(f.path);try{const row=db.prepare('SELECT body_json FROM loop_producer_results').get()!,body=JSON.parse(String(row.body_json));if(changed==='task')body.taskId='different-task';else body.executeStageId='different-execute';const encoded=canonical(body);db.prepare('UPDATE loop_producer_results SET body_json=?,body_hash=?').run(encoded,createHash('sha256').update('xiaok-loop-run-publication-basis-v1\0').update(encoded).digest('hex'));}finally{db.close();}
 const{owner,token}=await captured([f.path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();
});
it('rejects verification session whose original target is no longer ready',async()=>{
 const f=nativeFixture();change(f.path,"DELETE FROM loop_publication_attempts; UPDATE loop_native_attempts SET phase='retired',revision=2");const{owner,token}=await captured([f.path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();
});
function assistantOutputFixture(){
 const path=join(root,`assistant-output-${serial++}.sqlite`),store=new LoopStore(path),loopId='personal-assistant-evening-reflection';store.ensureBuiltInLoops(1);store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'Asia/Shanghai',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});store.setLoopStatus(loopId,'active',1);store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'assistant',assistantKind:'evening',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:{version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'original',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]},stages:{}}}});
 const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');store.openLoopPublicationProducer(began.run).recordAssistantOutput({summary:'Original',candidates:[{kind:'memory',title:'Original',content:'original content',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'original'}]},10);store.close();return path;
}
it.each(['original','member','evidence'])('checks original assistant output before candidates: %s',async mode=>{
 const path=assistantOutputFixture();
 if(mode==='member')change(path,"UPDATE assistant_candidates SET content='changed'");if(mode==='evidence')change(path,`UPDATE loop_producer_results SET evidence_ids_json='["foreign"]'`);const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const read=()=>[...iterateCapturedSQLiteLoopSources(owner,token)];if(mode==='original')expect(read).not.toThrow();else expect(read).toThrow();
});
it('rejects nonempty scan result evidence without any publication candidate',async()=>{
 const f=loopPublicationFixture(),path=join(root,`scan-evidence-${serial++}.sqlite`);try{f.store.close();copyFileSync(f.file,path);}finally{f.close();}change(path,`DELETE FROM loop_publication_candidates; UPDATE loop_producer_results SET evidence_ids_json='["foreign"]'`);const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();
});

it('preserves original repeated expected kinds and template evidence declarations',async()=>{
 const{path}=await taskFixture('unavailable',true,true),completion=new CompletionEvidenceStore(path);try{completion.upsertExpectation({id:'duplicate-kinds',ownerKind:'task',ownerId:'original',expectedKinds:['answer','answer'],source:'task_spec',confidence:'explicit',now:1});}finally{completion.close();}const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const events=[...iterateCapturedSQLiteLoopSources(owner,token)];expect(events.at(-1)?.kind).toBe('complete');const result=events.find(e=>e.kind==='row'&&e.table==='loop_producer_results');if(result?.kind!=='row')throw Error('result');expect(result.references.filter(r=>r.id==='original-evidence')).toHaveLength(2);
});
it.each([
 ['scanner-record',"UPDATE evidence_anomalies SET metadata_json=json_remove(metadata_json,'$.completionRecordId') WHERE loop_id='artifact-evidence-regression' AND kind<>'source_unavailable'"],
 ['health-owner',"UPDATE evidence_anomalies SET owner_id='foreign-health' WHERE loop_id='kswarm-service-health'"],
 ['success-failure',"UPDATE completion_records SET failure_kind='evidence_missing' WHERE id='completed-record'"],
 ['failed-success',"UPDATE completion_records SET ok=0,failure_kind=NULL WHERE id='completed-record'"],
])('rejects original scanner/completion invariant drift: %s',async(_name,sql)=>{
 const path=scannerFixture();change(path,sql);const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect(()=>[...iterateCapturedSQLiteLoopSources(owner,token)]).toThrow();
});
it('uses one actual SQLite parsing connection for exact schema and all declaration passes',async()=>{
 const paths=fixture(),{owner,token}=await captured(paths),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js'),{default:Sqlite}=await import('better-sqlite3');const connections=new Set<object>(),original=Sqlite.prototype.prepare;
 const spy=vi.spyOn(Sqlite.prototype,'prepare').mockImplementation(function(this:object,...args:Parameters<typeof original>){connections.add(this);return original.apply(this,args);});
 try{expect([...iterateCapturedSQLiteLoopSources(owner,token)].at(-1)?.kind).toBe('complete');expect(connections.size).toBe(1);}finally{spy.mockRestore();}
});
it.each(['scanner','origin','deleted-history'])('binds original configuration ownership while retaining history: %s',async mode=>{
 const f=loopPublicationFixture(),path=join(root,`config-owner-${serial++}.sqlite`);try{if(mode==='deleted-history')f.store.setLoopStatus(f.loopId,'deleted',30);f.store.close();copyFileSync(f.file,path);}finally{f.close();}
 const db=new DatabaseSync(path);try{if(mode==='scanner'){const row=db.prepare('SELECT * FROM loop_publication_configs').get()!,config=JSON.parse(String(row.configuration_json));config.contract.scanner='kswarm-service-health';db.prepare('UPDATE loop_publication_configs SET configuration_json=?').run(canonical(config));}if(mode==='origin')db.exec("UPDATE loop_definitions SET origin='user_template' WHERE id='artifact-evidence-regression'");}finally{db.close();}
 const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const read=()=>[...iterateCapturedSQLiteLoopSources(owner,token)];if(mode==='deleted-history')expect(read).not.toThrow();else expect(read).toThrow();
});
it('retains original deleted user template with its durable configuration and run history',async()=>{
 const{path}=await taskFixture('unavailable',true),store=new LoopStore(path);try{store.deleteUserLoopTemplate('actual-template');}finally{store.close();}const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');expect([...iterateCapturedSQLiteLoopSources(owner,token)].at(-1)?.kind).toBe('complete');
});
it.each(['original','owner','kind','evidence'])('binds actual artifact source-unavailable producer identity: %s',async mode=>{
 const[path]=fixture();change(path!, 'DROP TABLE completion_records');const scanner=new ArtifactEvidenceRegressionScanner(path!);try{expect(scanner.scan({now:30}).anomalies.some(a=>a.kind==='source_unavailable')).toBe(true);}finally{scanner.close();}const completion=new CompletionEvidenceStore(path!);if(mode==='evidence')completion.insertEvidence({id:'source-evidence',ownerKind:'loop_run',ownerId:'desktop-sqlite-completion-source',kind:'log_diagnostic',summary:'original source record',now:31});completion.close();if(mode==='kind')change(path!,"UPDATE evidence_anomalies SET owner_kind='goal' WHERE kind='source_unavailable'");if(mode==='evidence')change(path!,`UPDATE evidence_anomalies SET evidence_ids_json='["source-evidence"]' WHERE kind='source_unavailable'`);if(mode==='owner')change(path!,"UPDATE evidence_anomalies SET owner_id='foreign' WHERE kind='source_unavailable'");const{owner,token}=await captured([path!]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const read=()=>[...iterateCapturedSQLiteLoopSources(owner,token)];if(mode==='original')expect(read).not.toThrow();else expect(read).toThrow();
});

async function projectedAssistantFixture(unknown=false){
 const path=assistantOutputFixture(),store=new LoopStore(path),run=store.listLoopRuns('personal-assistant-evening-reflection',10)[0]!,candidate=store.recoverLoopPublicationCandidates({runId:run.id,requestSource:'user'})[0]!;
 const {createLoopPublicationWorkflow}=await import('../../../desktop/electron/loop-publication-workflow.js'),{createLoopBusinessPublicationHost}=await import('../../../desktop/electron/loop-business-publication-host.js'),{loopHostSubjectOwner}=await import('../../../src/runtime/verification/loop-host-subject.js');
 const native=readyLoopNative({store,candidate}),owner={profileId:'historical-loop-profile',...loopHostSubjectOwner(candidate.binding.subject)};publicationWire.routes.set(owner.ownerId,{kind:'protected-unregistered',authorityId:'original-authority',owner});publicationWire.applications.set(candidate.candidateId,{binding:candidate.binding,bindingHash:candidate.bindingHash,revision:1});publicationWire.publications.set(owner.ownerId,{binding:candidate.binding,challenge:{challengeId:'challenge-'+candidate.candidateId,owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}},observation:{owner,status:'committed',operationId:'operation-'+candidate.candidateId,fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'}});
 const workflow=createLoopPublicationWorkflow({store,assertAdmission(){},now:()=>40}),host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>100,assistantTargets:{async ensureMemory(){if(unknown)throw Error('original target unconfirmed');return{targetRef:'memory://original'};},async ensureKnowledge(){throw Error('unexpected');},async ensureFollowUp(){throw Error('unexpected');}}});
 try{await workflow.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user'});await host.project({runId:run.id,requestSource:'user'});const member=store.listAssistantCandidates({statuses:['pending']})[0]!;const accepted=host.acceptAssistantCandidate({candidateId:member.id,requestSource:'user'});if(unknown)await expect(accepted).rejects.toThrow('original target unconfirmed');else expect((await accepted).status).toBe('accepted');}finally{await host.close();await workflow.close();store.close();}return path;
}
it.each([[false,false],[true,false],[false,true],[true,true]])('binds original projected assistant member back to intent, missing=%s unknown=%s',async(missing,unknown)=>{
 const path=await projectedAssistantFixture(unknown);if(missing)change(path,'DELETE FROM assistant_promotion_intents');const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loops.js');const read=()=>[...iterateCapturedSQLiteLoopSources(owner,token)];if(missing)expect(read).toThrow();else expect(read).not.toThrow();
});

it('keeps an original retained journal with no recorded candidate unknown after actual template deletion',async()=>{
 const path=join(root,`legacy-exports-${serial++}.sqlite`),store=new LoopStore(path),id=randomUUID(),loopId='legacy-export-loop';let original:unknown;
 try{store.createUserLoopTemplate({loopId,title:'Original',kind:'task_completion',prompt:'Original',outputDirectory:'',outputFileName:'',now:1});original=store.prepareLoopArtifactExport({id,requestSource:'user',now:2,source:{loopId,runId:'unrecorded-run',candidateId:'unrecorded-candidate',candidateRevision:1,payloadHash:'b'.repeat(64),vectorHash:'c'.repeat(64),descriptor:{selection:{kind:'local',obligationId:'original',path:'result'},sha256:'a'.repeat(64),size:12}},destination:{parent:root,parentIdentity:{device:'1',inode:'2'},temporaryName:'.xiaok-export-'+id,targetName:'result',ownershipToken:'d'.repeat(64)}}).record;store.deleteUserLoopTemplate(loopId);expect(store.getLoopArtifactExport(id)).toEqual(original);}finally{store.close();}
 const db=new DatabaseSync(path);try{expect(db.prepare('SELECT count(*) AS n FROM loop_publication_candidates').get()?.n).toBe(0);expect(db.prepare('SELECT count(*) AS n FROM loop_verification_sessions').get()?.n).toBe(0);expect(db.prepare('SELECT count(*) AS n FROM loop_producer_results').get()?.n).toBe(0);expect(db.prepare('SELECT count(*) AS n FROM loop_artifact_exports').get()?.n).toBe(1);}finally{db.close();}
 const{owner,token}=await captured([path]),{iterateCapturedSQLiteLoopSources}=await import('../../../src/runtime/verification/captured-sqlite-loop-stream.js');const events:unknown[]=[];expect(()=>{for(const event of iterateCapturedSQLiteLoopSources(owner,token))events.push(event);}).toThrow();expect(events.some(event=>(event as {kind:string}).kind==='complete')).toBe(false);
});
it('preserves actual candidate-backed exports when original history clear is refused by its foreign keys',async()=>{
 const path=exportFixture(),store=new LoopStore(path);try{expect(()=>store.clearLoopRunHistory('artifact-evidence-regression')).toThrow('FOREIGN KEY');expect(store.listLoopArtifactExports().items).toHaveLength(2);}finally{store.close();}
 const{owner,token}=await captured([path]),{readCapturedSQLiteLoopSources}=await import('../../support/captured-loop-stream-collector.js');expect(readCapturedSQLiteLoopSources(owner,token).sources[0]!.tables.loop_artifact_exports).toHaveLength(2);
});
