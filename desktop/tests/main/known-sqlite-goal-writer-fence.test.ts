import {setProfileTestHome} from '../../../tests/support/profile-home-env.js';
// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const fixture=vi.hoisted(()=>({home:'',reads:0,denyAccount:false}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>{fixture.reads++;if(fixture.denyAccount)throw Error('unexpected_posix_locator');return {...actual.userInfo(),homedir:fixture.home};}};});
// Override the old unit setup's observer noop: this leaf exercises actual registry IO.
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
import {createGoalCompletionIntent} from '../../../src/runtime/goal/completion-intent.js';
import {createGoalPublicationAttempt,type GoalPublicationAttempt} from '../../../src/runtime/goal/publication-attempt.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
let root:string;const stores:SqliteGoalStore[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'known-sqlite-goal-')));fixture.home=join(root,'account');setProfileTestHome(fixture.home);mkdirSync(fixture.home,{mode:0o750});mkdirSync(join(fixture.home,'.xiaok'),{mode:0o755});mkdirSync(join(fixture.home,'.xiaok','profile-sources'),{mode:0o700});fixture.denyAccount=false;fixture.reads=0;});
afterEach(()=>{fixture.denyAccount=false;for(const store of stores.splice(0).reverse())store.close();rmSync(root,{recursive:true,force:true});});
function open(path:string){const store=new SqliteGoalStore(path);stores.push(store);return store;}
async function seeded(){const directory=join(root,'goals'),path=join(directory,'goals.db'),store=open(path),state={...createGoalState({sessionId:'session',objective:'original',expectedEvidenceKinds:['answer'],now:1}),turnsUsed:1,tokensUsed:7};const intent=createGoalCompletionIntent({state,taskId:'task',turnId:'turn',summary:'original claim',now:1});await store.commit({sessionId:'session',expectedRevision:null,next:state,events:[],evidence:[],turns:[{goalId:state.goalId,epoch:state.epoch,turnId:'turn',tokensUsed:7,activeWallClockMs:9,recordedAt:1}],completionIntent:{expectedRevision:null,next:intent}});const attempt=createGoalPublicationAttempt(intent,'user',2,1);await store.updateCompletionAttempt('session',{expectedRevision:null,next:attempt});store.bindTask({goalId:state.goalId,epoch:1,goalTurnId:'turn',threadId:'session',taskId:'bound',origin:'user',attachedAt:null});return {directory,path,store,state,intent,attempt};}
const fence=(directory:string)=>createKnownDirectoryWriterFence(directory,'sqlite-db').persist();
function files(directory:string){return Object.fromEntries(readdirSync(directory).sort().map(name=>[name,{bytes:readFileSync(join(directory,name)),inode:statSync(join(directory,name)).ino}]));}
it('rejects all actual cached Goal transaction siblings after lower-component publication while preserving reads and complete DB WAL SHM bytes',async()=>{
 const f=await seeded();fence(f.directory);const original=await f.store.load('session'),before=files(f.directory);await expect(f.store.commit({sessionId:'session',expectedRevision:f.state.revision,next:{...f.state,revision:f.state.revision+1,objective:'forbidden'},events:[],turns:[],evidence:[]})).rejects.toThrow('fenced');const another=createGoalCompletionIntent({state:f.state,taskId:'other-task',turnId:'turn',summary:'other claim',now:2});await expect(f.store.updateCompletionIntent('session',{expectedRevision:null,next:another})).rejects.toThrow('fenced');const next:GoalPublicationAttempt={...f.attempt,revision:2,status:'not_prepared',retirement:{status:'not_prepared'},updatedAt:3};await expect(f.store.updateCompletionAttempt('session',{expectedRevision:1,next})).rejects.toThrow('fenced');
 // Pending publication is not a native grant: this negative call checks that
 // admission rejects before reading it, without fabricating a committed proof.
 await expect(f.store.finalizeCompletionAttempt('session',f.attempt.attemptId)).rejects.toThrow('fenced');expect(()=>f.store.bindTask({goalId:f.state.goalId,epoch:1,goalTurnId:'turn',threadId:'session',taskId:'new-bound',origin:'user',attachedAt:null})).toThrow('fenced');expect(()=>f.store.recordContextTask({goalId:f.state.goalId,threadId:'session',taskId:'new-context',recordedAt:3})).toThrow('fenced');expect(()=>f.store.markTaskAttached('bound',3)).toThrow('fenced');expect(await f.store.load('session')).toEqual(original);expect(await f.store.loadCompletionIntent('session',f.intent.intentId)).toEqual(f.intent);expect(await f.store.listCompletionAttempts('session',f.intent.intentId)).toEqual([f.attempt]);expect(f.store.listTaskBindings('session')[0].attachedAt).toBeNull();expect(files(f.directory)).toEqual(before);
});
it('rejects reconstructed and same-directory new-basename Goal constructors before database creation or schema writes',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.directory),fresh=join(f.directory,'another.db');expect(()=>open(f.path)).toThrow('fenced');expect(()=>open(fresh)).toThrow('fenced');expect(existsSync(fresh)).toBe(false);expect(files(f.directory)).toEqual(before);
});
it('rejects an independent Node original Goal database constructor and leaves the original logical rows and files intact',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.directory),script=join(root,'child.mjs');const {writeFileSync}=await import('node:fs');writeFileSync(script,`import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const original=os.userInfo.bind(os);os.userInfo=()=>({...original(),homedir:${JSON.stringify(fixture.home)}});syncBuiltinESMExports();const {SqliteGoalStore}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(),'electron','goal-store-sqlite.ts')).href)});try{const store=new SqliteGoalStore(${JSON.stringify(f.path)});store.close();throw Error('unexpected SQLite open');}catch(error){if(!/fenced/.test(String(error)))throw error;}`);const result=await new Promise<{code:number|null;stderr:string}>((done,reject)=>{const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);child.once('error',reject);child.once('close',code=>done({code,stderr}));});expect(result.code,result.stderr).toBe(0);expect(files(f.directory)).toEqual(before);expect((await f.store.load('session'))?.state).toEqual(f.state);
});
it('preserves a new ordinary durable first write, readonly missing fence probe and another directory namespace',async()=>{
 const directory=join(root,'first');createKnownDirectoryWriterFence(directory,'sqlite-db').assertOpen();expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);const store=open(join(directory,'first.db')),state=createGoalState({sessionId:'first',objective:'first',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'first',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).not.toContain('writer-fences');fence(directory);const other=open(join(root,'other','other.db'));await other.commit({sessionId:'first',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});expect((await other.load('first'))?.state).toEqual(state);
});
for(const path of [':memory:',''])it(`keeps original ${JSON.stringify(path)} ephemeral constructor and transactions free of POSIX locator or durable namespace`,async()=>{
 fixture.denyAccount=true;fixture.reads=0;const store=open(path),state=createGoalState({sessionId:'ephemeral',objective:'real original',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'ephemeral',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});expect((await store.load('ephemeral'))?.state).toEqual(state);expect(fixture.reads).toBe(0);expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);
});
it('rejects a borrowed transaction owner before caller db getters or BEGIN',()=>{
 let reads=0,work=0;const transaction=(SqliteGoalStore.prototype as unknown as {transaction<T>(work:()=>T):T}).transaction;expect(()=>transaction.call({get db(){reads++;throw Error('unexpected_db_getter');}},()=>{work++;})).toThrow('owner');expect(reads).toBe(0);expect(work).toBe(0);
});
it('keeps the existing Windows ordinary component branch free of added POSIX locator checks',async()=>{
 fixture.denyAccount=true;fixture.reads=0;const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');try{const store=open(join(root,'windows-branch','goal.db')),state=createGoalState({sessionId:'windows',objective:'original',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'windows',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});expect((await store.load('windows'))?.state).toEqual(state);expect(fixture.reads).toBe(0);expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);}finally{platform.mockRestore();}
});
