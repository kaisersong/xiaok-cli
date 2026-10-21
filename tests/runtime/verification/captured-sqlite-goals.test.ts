import {beforeAll,afterAll,afterEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';import {mkdtempSync,realpathSync,statSync,rmSync,copyFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,basename,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SqliteGoalStore} from '../../../desktop/electron/goal-store-sqlite.js';
import {createGoalState,reduceGoal} from '../../../src/runtime/goal/reducer.js';
import {createGoalCompletionIntent} from '../../../src/runtime/goal/completion-intent.js';
import {createGoalPublicationAttempt} from '../../../src/runtime/goal/publication-attempt.js';
import {startProfileSourceCapture,readProfileSourceCapture} from '../../../src/runtime/verification/profile-source-capture.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-sqlite-goals-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
const cleanups:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
beforeAll(()=>{const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));let sequence=0;
async function fixture(empty=false){
 const path=join(root,`goals-${sequence++}.sqlite`),store=new SqliteGoalStore(path);let oldGoal='',currentGoal='';
 try{if(!empty){const first={...createGoalState({sessionId:'logical-thread',objective:'old goal',expectedEvidenceKinds:['answer'],now:1}),status:'cancelled' as const,turnsUsed:1,tokensUsed:1,activeWallClockMs:1,updatedAt:2};oldGoal=first.goalId;
 const intent=createGoalCompletionIntent({state:first,taskId:'original-task',turnId:'claim-turn',summary:'original claim',now:2});
 await store.commit({sessionId:'logical-thread',expectedRevision:null,next:first,events:[{eventId:'original-event',goalId:first.goalId,revision:1,type:'created',actor:'user',recordedAt:1}],turns:[{goalId:first.goalId,epoch:1,turnId:'finished-turn',tokensUsed:1,activeWallClockMs:1,recordedAt:2}],evidence:[{goalId:first.goalId,epoch:1,goalTurnId:'finished-turn',evidenceId:'evidence',record:{ownerKind:'task',ownerId:'evidence-task',kind:'answer',summary:'original'},recordedAt:2}],completionIntent:{expectedRevision:null,next:intent}});
 await store.updateCompletionAttempt('logical-thread',{expectedRevision:null,next:createGoalPublicationAttempt(intent,'user',2,1)});
 store.bindTask({goalId:first.goalId,epoch:1,goalTurnId:'claim-turn',threadId:'logical-thread',taskId:'original-task',origin:'continuation',attachedAt:null});store.recordContextTask({goalId:first.goalId,threadId:'logical-thread',taskId:'context-task',recordedAt:2});
 const next=createGoalState({sessionId:'logical-thread',objective:'current goal',expectedEvidenceKinds:['answer'],now:3});currentGoal=next.goalId;await store.commit({sessionId:'logical-thread',expectedRevision:first.revision,next,events:[],turns:[],evidence:[]});store.bindTask({goalId:next.goalId,epoch:1,goalTurnId:'not-finished',threadId:'logical-thread',taskId:'pending-task',origin:'user',attachedAt:3});}}
 finally{store.close();}return{path,oldGoal,currentGoal};
}
async function captured(paths:string[]){const sources=paths.map((path,index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return{sourceId:`goal-source-${index}`,kind:'sqlite-db' as const,snapshotFormat:'goal-sqlite-v1' as const,directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};});const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});cleanups.push(()=>owner.close());return{owner,token:await owner.capture()};}
function change(path:string,sql:string){const db=new DatabaseSync(path);try{db.exec(sql);}finally{db.close();}}
it('retains every historical Goal and relationship from actual multiple native captured sources',async()=>{
 const first=await fixture(),second=await fixture(),{owner,token}=await captured([first.path,second.path]);const {readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');
 const before=readProfileSourceCapture(owner,token),facts=readCapturedSQLiteGoalSources(owner,token);expect(facts.kind).toBe('captured-sqlite-goal-declarations');expect(facts.sources).toHaveLength(2);
 const source=facts.sources[0]!;expect(source.goals.map(goal=>goal.goalId).sort()).toEqual([first.oldGoal,first.currentGoal].sort());expect(source.pointers).toEqual([{logicalContainerId:'logical-thread',currentGoalId:first.currentGoal,updatedAt:3}]);expect(source.taskBindings.map(row=>row.taskId).sort()).toEqual(['original-task','pending-task']);expect(source.contextTasks.map(row=>row.taskId)).toEqual(['context-task']);expect(source.goals.find(goal=>goal.goalId===first.oldGoal)?.declaration.referencedOwners).toContainEqual({ownerKind:'task',ownerId:'evidence-task'});expect(source.snapshotHash).toBe(before.sources[0]!.snapshotHash);expect(Object.isFrozen(source.taskBindings[0])).toBe(true);expect(facts).not.toHaveProperty('nativeSessionIds');
 expect(()=>readCapturedSQLiteGoalSources({...owner},token)).toThrow('brand');expect(()=>readCapturedSQLiteGoalSources(owner,{...token})).toThrow('brand');await owner.checkCurrent();await owner.close();expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow('closed');
});
it('accepts an original empty Goal database without inventing a logical or native session',async()=>{const {path}=await fixture(true),{owner,token}=await captured([path]);const {readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(readCapturedSQLiteGoalSources(owner,token).sources[0]).toMatchObject({goals:[],pointers:[],taskBindings:[],contextTasks:[]});});
it.each([
 ['state-key',"UPDATE goals SET session_id='wrong' WHERE created_at=1"],
 ['state-json-duplicate',`UPDATE goals SET state_json=substr(state_json,1,length(state_json)-1)||',"revision":1}' WHERE created_at=1`],
 ['event-key',"UPDATE goal_events SET revision=99"],
 ['event-orphan',"UPDATE goal_events SET goal_id='missing'"],
 ['turn-key',"UPDATE goal_turns SET epoch=2"],
 ['evidence-key',"UPDATE goal_evidence SET recorded_at=99"],
 ['intent-key',"UPDATE goal_completion_intents SET revision=99"],
 ['attempt-key',"UPDATE goal_publication_attempts SET sequence=2"],
 ['pointer',"UPDATE goal_sessions SET current_goal_id='missing'"],
 ['pointer-time',"UPDATE goal_sessions SET updated_at=99"],
 ['missing-container',"DELETE FROM goal_sessions"],
 ['binding-thread',"UPDATE goal_thread_tasks SET thread_id='foreign-thread' WHERE task_id='pending-task'"],
 ['binding-task-overlap',"UPDATE goal_thread_context_tasks SET task_id='original-task'"],
 ['ordinal',"UPDATE goal_thread_context_tasks SET ordinal=1"],
 ['context-orphan',"UPDATE goal_thread_context_tasks SET goal_id='missing'"],
 ['extra-schema',"CREATE TABLE unlisted(payload TEXT)"],
 ['changed-index',"DROP INDEX goals_session_id;CREATE INDEX goals_session_id ON goals(revision)"],
] as const)('refuses actual captured inconsistency without omitting the affected history: %s',async(_name,sql)=>{const{path}=await fixture();change(path,sql);const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow();});
it.each([
 ['goals','state_json','revision'],['goal_events','event_json','eventId'],['goal_turns','turn_json','turnId'],['goal_evidence','evidence_json','evidenceId'],['goal_completion_intents','intent_json','intentId'],['goal_publication_attempts','attempt_json','attemptId'],
] as const)('rejects decoded duplicate JSON keys in every original payload column: %s',async(table,column,key)=>{
 const{path}=await fixture();const escaped=key.slice(0,-1)+'\\u'+key.charCodeAt(key.length-1).toString(16).padStart(4,'0');change(path,`UPDATE ${table} SET ${column}=substr(${column},1,length(${column})-1)||',"${escaped}":null}'`);const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow('duplicate');
});
it('validates the original full publication journal after projected row fields agree',async()=>{const{path}=await fixture();change(path,"UPDATE goal_publication_attempts SET sequence=2,attempt_json=json_set(attempt_json,'$.sequence',2)");const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow('goal_journal_sequence');});
it('rejects altered column constraints even if every retained pointer row is well formed',async()=>{const{path}=await fixture();change(path,'ALTER TABLE goal_sessions RENAME TO old_pointer;CREATE TABLE goal_sessions(session_id text primary key,current_goal_id text,updated_at integer not null);INSERT INTO goal_sessions SELECT * FROM old_pointer;DROP TABLE old_pointer');const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow('schema');});

it('keeps equal historical identities in two distinct original physical sources',async()=>{const first=await fixture(),copy=join(root,`goals-copy-${sequence++}.sqlite`);copyFileSync(first.path,copy);const{owner,token}=await captured([first.path,copy]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');const facts=readCapturedSQLiteGoalSources(owner,token);expect(facts.sources).toHaveLength(2);expect(facts.sources[0]!.goals).toEqual(facts.sources[1]!.goals);expect(facts.sources[0]!.sourceId).not.toBe(facts.sources[1]!.sourceId);});

it.each([
 ['current-application',"UPDATE goal_completion_intents SET intent_json=json_set(intent_json,'$.application.objective','foreign');UPDATE goal_publication_attempts SET attempt_json=json_set(attempt_json,'$.application.objective','foreign')"],
 ['unreachable-claimed',"UPDATE goal_completion_intents SET revision=2,intent_json=json_set(intent_json,'$.revision',2)"],
] as const)('rejects reviewed semantic inconsistency after all row projections agree: %s',async(_name,sql)=>{const{path}=await fixture();change(path,sql);const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow();});

it('preserves an original immutable older epoch intent after a real replacement commit',async()=>{
 const path=join(root,`goals-history-${sequence++}.sqlite`),store=new SqliteGoalStore(path);
 try{const state=createGoalState({sessionId:'thread-history',objective:'original',expectedEvidenceKinds:['answer'],now:1}),intent=createGoalCompletionIntent({state,taskId:'task-history',turnId:'turn-history',summary:'claim',now:1});
 await store.commit({sessionId:state.sessionId,expectedRevision:null,next:state,events:[],turns:[],evidence:[],completionIntent:{expectedRevision:null,next:intent}});
 const next=reduceGoal(state,{type:'replace',objective:'replacement',expectedEvidenceKinds:['answer'],now:2});
 await store.commit({sessionId:state.sessionId,expectedRevision:state.revision,next,events:[],turns:[],evidence:[]});
 }finally{store.close();}
 const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');expect(readCapturedSQLiteGoalSources(owner,token).sources[0]!.goals[0]!.epoch).toBe(2);
});
it.each(['valid','missing-attempt','different-observation','stale-finalization-time'])('validates actual finalizeCompletionAttempt revision 2 against its original journal: %s',async(mode)=>{
 const{path,oldGoal}=await fixture(),store=new SqliteGoalStore(path);
 try{const original=store.loadGoalById(oldGoal)!.completionAttempts![0]!,challenge={challengeId:'challenge',owner:{profileId:'profile',ownerKind:'goal' as const,ownerId:oldGoal},fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:200}};
 const prepared={...original,revision:2,status:'prepared' as const,challenge,updatedAt:3};await store.updateCompletionAttempt('logical-thread',{expectedRevision:1,next:prepared});
 const authorizing={...prepared,revision:3,status:'authorizing' as const,updatedAt:4};await store.updateCompletionAttempt('logical-thread',{expectedRevision:2,next:authorizing});
 await store.updateCompletionAttempt('logical-thread',{expectedRevision:3,next:{...authorizing,revision:4,status:'committed',updatedAt:5,observation:{status:'committed',owner:challenge.owner,operationId:'operation',fullTupleHash:challenge.fullTupleHash,businessRevision:1,currentVerification:'valid'}}});
 expect(await store.finalizeCompletionAttempt('logical-thread',original.attemptId)).toMatchObject({revision:2,status:'committed'});
 }finally{store.close();}
 if(mode==='stale-finalization-time')change(path,"UPDATE goal_completion_intents SET intent_json=json_set(intent_json,'$.updatedAt',3)");
 if(mode==='missing-attempt')change(path,'DELETE FROM goal_publication_attempts');if(mode==='different-observation')change(path,"UPDATE goal_completion_intents SET intent_json=json_set(intent_json,'$.observation.operationId','foreign-operation')");
 const{owner,token}=await captured([path]);const{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js');if(mode==='valid')expect(readCapturedSQLiteGoalSources(owner,token).sources[0]!.goals).toHaveLength(2);else expect(()=>readCapturedSQLiteGoalSources(owner,token)).toThrow();
});


it('preserves per-Goal original native declaration associations without copying historical tasks to current Goal',async()=>{
 const f=await fixture(),{owner,token}=await captured([f.path]),{readCapturedSQLiteGoalSources}=await import('../../../src/runtime/verification/captured-sqlite-goals.js'),source=readCapturedSQLiteGoalSources(owner,token).sources[0]!;
 const old=Reflect.get(source.goals.find(v=>v.goalId===f.oldGoal)!.declaration,'goalAssociations'),current=Reflect.get(source.goals.find(v=>v.goalId===f.currentGoal)!.declaration,'goalAssociations');
 expect(old).toEqual([expect.objectContaining({goalId:f.oldGoal,logicalContainerId:'logical-thread',completionTasks:[expect.objectContaining({taskId:'original-task',epoch:1})],evidenceOwners:[expect.objectContaining({ownerId:'evidence-task',epoch:1,goalTurnId:'finished-turn',evidenceId:'evidence'})]})]);
 expect(current).toEqual([{goalId:f.currentGoal,logicalContainerId:'logical-thread',completionTasks:[],evidenceOwners:[]}]);expect(Object.isFrozen(old[0].completionTasks[0])).toBe(true);
});
