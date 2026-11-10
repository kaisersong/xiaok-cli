// @vitest-environment node
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach,expect,it} from 'vitest';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {executeOwnedInitialPlanBootstrap} from '../../electron/kswarm-owned-initial-plan.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const payload={projectId:'p',projectName:'Project',goal:'g',requirements:'',planningGuidance:'',poAgent:'po',members:['w'],startPolicy:'plan_only' as const};
function fixture(){const root=mkdtempSync(join(tmpdir(),'bootstrap-identity-'));roots.push(root);return {root,store:new JsonKSwarmInitialPlanBootstrapStore(root)};}
it('freezes a canonical enqueue identity, manifest and plan run before launch and across reopen',()=>{
 const {root,store}=fixture();const first=store.upsertPending(payload,1);
 expect(first.enqueueKey).toBeTruthy();expect(first.planRunId).toBeTruthy();expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
 expect(new JsonKSwarmInitialPlanBootstrapStore(root).upsertPending({...payload},9)).toEqual(first);
});
it('rejects changed payload or start policy under the same project identity',()=>{
 const {store}=fixture();const before=store.upsertPending(payload,1);
 for(const changed of [{goal:'other'},{startPolicy:'activate_and_dispatch_after_plan' as const},{members:['other']}]) {
  expect(()=>store.upsertPending({...payload,...changed},2)).toThrow('bootstrap_payload_conflict');
 }
 expect(store.list()).toEqual([before]);
});
it('duplicate enqueue cannot reset failed attempts or revive a terminal job',()=>{
 const {store}=fixture();store.upsertPending(payload,1);
 for(let i=0;i<3;i++){const [claim]=store.claimDue(1e6,1);store.markFailed('p',i+2,'known failure',claim.claimToken!);}
 const before=store.list()[0];expect(before.status).toBe('failed');
 expect(store.upsertPending(payload,1e9)).toEqual(before);expect(store.claimDue(1e9,1)).toEqual([]);
});
it('elapsed wall time alone cannot reclaim a launched job or make it schedulable',()=>{
 const {root,store}=fixture();store.upsertPending(payload,1);const [first]=store.claimDue(2,1);
 const reopened=new JsonKSwarmInitialPlanBootstrapStore(root);
 expect(reopened.claimDue(1e12,1)).toEqual([]);expect(reopened.nextDueAt(1e12)).toBeNull();
 expect(reopened.list()[0].planRunId).toBe(first.planRunId);
});
it('corrupt journal and invalid entries fail closed instead of silently creating replacement work',()=>{
 const {root,store}=fixture();const path=join(root,'kswarm-initial-plan-bootstrap-jobs.json');
 for(const raw of ['{','{"jobs":{}}','{"jobs":[{}]}']) {
  writeFileSync(path,raw);expect(()=>store.upsertPending(payload,1)).toThrow();expect(()=>store.list()).toThrow();
 }
});
it('actual queue delivers the frozen run identity once for repeated enqueues',async()=>{
 const {store}=fixture();const seen:unknown[]=[];
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async job=>{seen.push(job);return {ok:true};},
  {setTimeoutFn:()=>({unref(){}} as unknown as unknown as NodeJS.Timeout)});
 for(let i=0;i<100;i++)expect(queue.enqueue(payload).ok).toBe(true);
 await queue.runOnce();await queue.runOnce();queue.stopAccepting();await queue.drain();
 expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({enqueueKey:store.list()[0].enqueueKey,planRunId:store.list()[0].planRunId});
});
it('throwing after launch retains an unknown launch and never retries it by time',async()=>{
 const {store}=fixture();store.upsertPending(payload,1);let calls=0;
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{calls++;throw Error('lost launch response');});
 await queue.runOnce();await queue.runOnce();queue.stopAccepting();await queue.drain();
 expect(calls).toBe(1);expect(store.list()[0]).toMatchObject({status:'launch_unknown',lastError:'lost launch response'});
});
it('late results and old claim tokens cannot overwrite unknown or a newer claim',()=>{
 const {store}=fixture();store.upsertPending(payload,1);const [claim]=store.claimDue(2,1);
 store.markLaunchUnknown('p',3,'unknown',claim.claimToken!);
 const before=store.list()[0];
 expect(()=>store.markSucceeded('p',4,claim.claimToken!)).toThrow('bootstrap_claim_conflict');
 expect(()=>store.markFailed('p',4,'late failure',claim.claimToken!)).toThrow('bootstrap_claim_conflict');
 expect(store.list()[0]).toEqual(before);
});
it('enqueue reports existing failed and unknown work without falsely reporting queued',async()=>{
 const {store}=fixture();store.upsertPending(payload,1);const [claim]=store.claimDue(2,1);store.markLaunchUnknown('p',3,'unknown',claim.claimToken!);
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>({ok:true}));
 const result=queue.enqueue(payload);queue.stopAccepting();await queue.drain();
 expect(result).toEqual({ok:true,status:'launch_unknown'});
});
it('parallel real Node processes claim a single persisted job at most once',async()=>{
 const {root,store}=fixture();store.upsertPending(payload,1);
 const moduleUrl=new URL('../../electron/kswarm-initial-plan-bootstrap.ts',import.meta.url).href;
 const cwd=fileURLToPath(new URL('../../../',import.meta.url));
 const script='import {JsonKSwarmInitialPlanBootstrapStore} from '+JSON.stringify(moduleUrl)+';'
  +'try{console.log(JSON.stringify({claims:new JsonKSwarmInitialPlanBootstrapStore('+JSON.stringify(root)+').claimDue(10,1).map(j=>j.planRunId)}));}'
  +'catch(error){if(error.message!=="bootstrap_journal_busy")throw error;console.log(JSON.stringify({busy:true}));}';
 const outputs=await Promise.all(Array.from({length:8},()=>new Promise<{claims?:string[];busy?:boolean}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const timer=setTimeout(()=>{child.kill('SIGKILL');},10000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);console.log(JSON.stringify({test:'bootstrap-parallel-claim',pid:child.pid,exitCode:code,reaped:true}));
   if(code!==0)return reject(Error(stderr));try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});
 })));
 expect(outputs.flatMap(output=>output.claims??[])).toHaveLength(1);
 expect(store.list()[0].status).toBe('running');
});
it('legacy imports remain unverified and cannot be launched or overwritten without authenticated reconciliation',async()=>{
 const {root,store}=fixture();
 const legacy={...payload,id:'p',status:'pending',attempts:0,maxAttempts:3,nextAttemptAt:1,createdAt:1,updatedAt:1};
 writeFileSync(join(root,'kswarm-initial-plan-bootstrap-jobs.json'),JSON.stringify({jobs:[legacy]}));
 expect(store.list()[0]).toMatchObject({legacyImport:true,status:'legacy_unverified'});
 expect(store.claimDue(1e9,1)).toEqual([]);expect(store.nextDueAt(1e9)).toBeNull();
 expect(()=>store.upsertPending({...payload,goal:'replacement'},2)).toThrow('bootstrap_legacy_reconciliation_required');
 let calls=0;const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{calls++;return {ok:true};});
 await queue.runOnce();queue.stopAccepting();await queue.drain();expect(calls).toBe(0);
});
it('keeps the owner enqueue identity and model candidate across restart without granting a second model attempt',()=>{
 const {root,store}=fixture();const ownerBinding={protocol:'ordinary_initial_plan_v1' as const,projectId:'p',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'main-create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1 as const};
 const job=store.upsertPending({...payload,ownerBinding},1);expect(job.enqueueKey).toBe(ownerBinding.enqueueKey);
 const [claim]=store.claimDue(2,1);const request={enqueueKey:job.enqueueKey,planRunId:job.planRunId,planGeneration:1 as const,expectedPlanInputRevision:4,startPolicy:'plan_only' as const};
 store.recordOwnerClaimRequest('p',claim.claimToken!,request);store.recordModelAttempt('p',claim.claimToken!);
 expect(()=>store.recordModelAttempt('p',claim.claimToken!)).toThrow('bootstrap_model_attempt_already_started');
 const candidate={plan:{analysis:'result',phases:[]},tasks:[{title:'Task'}]};store.recordPlanCandidate('p',claim.claimToken!,candidate);
 expect(()=>store.recordPlanCandidate('p',claim.claimToken!,{...candidate,tasks:[]})).toThrow('bootstrap_plan_candidate_conflict');
 expect(new JsonKSwarmInitialPlanBootstrapStore(root).list()[0]).toMatchObject({ownerBinding,ownerClaimRequest:request,modelAttempted:true,planCandidate:candidate});
});
it('cannot checkpoint another claim or change an existing owner request envelope',()=>{
 const {store}=fixture();store.upsertPending({...payload,ownerBinding:{protocol:'ordinary_initial_plan_v1',projectId:'p',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'main-create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1}},1);
 const [claim]=store.claimDue(2,1);const request={enqueueKey:claim.enqueueKey,planRunId:claim.planRunId,planGeneration:1 as const,expectedPlanInputRevision:0,startPolicy:'plan_only' as const};
 expect(()=>store.recordModelAttempt('p','wrong')).toThrow('bootstrap_claim_conflict');
 store.recordOwnerClaimRequest('p',claim.claimToken!,request);
 expect(()=>store.recordOwnerClaimRequest('p',claim.claimToken!,{...request,expectedPlanInputRevision:1})).toThrow('bootstrap_owner_claim_conflict');
});
it('the original queue resumes persisted pending work after a real foreign lock clears without changing run or attempts',async()=>{
 const {root,store}=fixture();const original=store.upsertPending(payload,1);const fs=await import('node:fs');const lock=join(root,'kswarm-initial-plan-bootstrap-jobs.json.lock');let fd:number|undefined=fs.openSync(lock,'wx',0o600);let calls=0;
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async job=>{calls++;expect(job.planRunId).toBe(original.planRunId);return {ok:true};});
 try{
  await queue.runOnce();expect(queue.getHealth()).toEqual({ok:false,error:'bootstrap_journal_busy'});expect(calls).toBe(0);expect(store.list()[0]).toMatchObject({status:'pending',attempts:0,planRunId:original.planRunId});
  fs.closeSync(fd);fd=undefined;fs.unlinkSync(lock);
  const deadline=Date.now()+2000;while(calls===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  expect(calls).toBe(1);await queue.drain();expect(queue.getHealth()).toEqual({ok:true,error:null});expect(store.list()[0]).toMatchObject({status:'succeeded',attempts:0,planRunId:original.planRunId});
 }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}queue.stopAccepting();await queue.drain();}
});
it('stopping a temporarily busy original queue never launches a late retry',async()=>{
 const {root,store}=fixture();store.upsertPending(payload,1);const fs=await import('node:fs');const lock=join(root,'kswarm-initial-plan-bootstrap-jobs.json.lock');const fd=fs.openSync(lock,'wx',0o600);let calls=0;
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{calls++;return {ok:true};});
 try{await queue.runOnce();queue.stopAccepting();}finally{fs.closeSync(fd);fs.unlinkSync(lock);await queue.drain();}
 await new Promise(resolve=>setTimeout(resolve,350));expect(calls).toBe(0);expect(store.list()[0].status).toBe('pending');
});
it('a real journal read error in the scheduling tail is latched rather than escaping the background run',async()=>{
 const {root,store}=fixture();store.upsertPending(payload,1);
 const next=store.nextDueAt.bind(store);store.nextDueAt=now=>{writeFileSync(join(root,'kswarm-initial-plan-bootstrap-jobs.json'),'{');return next(now);};
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>({ok:true}));
 try{await expect(queue.runOnce()).resolves.toBeUndefined();expect(queue.getHealth().ok).toBe(false);await expect(queue.runOnce()).resolves.toBeUndefined();}
 finally{queue.stopAccepting();await queue.drain();}
});
it.each([
 {kind:'success',result:{ok:true},status:'succeeded',attempts:0},
 {kind:'unknown',result:{ok:false,error:'lost model ACK',launchOutcome:'unknown'},status:'launch_unknown',attempts:0},
 {kind:'not_started',result:{ok:false,error:'before model gate',launchOutcome:'not_started'},status:'pending',attempts:0},
 {kind:'failure',result:{ok:false,error:'known business rejection'},status:'pending',attempts:1},
] as const)('retains and retries only the original %s transition after its real terminal-write lock clears',async ({result,status,attempts})=>{
 const {root,store}=fixture(),initial=store.upsertPending(payload,1),fs=await import('node:fs'),lock=join(root,'kswarm-initial-plan-bootstrap-jobs.json.lock');let fd:number|undefined,calls=0;
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{calls++;fd=fs.openSync(lock,'wx',0o600);return result;});
 try{
  await queue.runOnce();expect(calls).toBe(1);expect(queue.getHealth().ok).toBe(false);expect(store.list()[0].status).toBe('running');
  fs.closeSync(fd!);fd=undefined;fs.unlinkSync(lock);
  const deadline=Date.now()+2000;while(store.list()[0].status==='running'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  expect(store.list()[0]).toMatchObject({status,attempts,planRunId:initial.planRunId});expect(calls).toBe(1);expect(queue.getHealth()).toEqual({ok:true,error:null});
 }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}queue.stopAccepting();await queue.drain();}
});
it('reads a frozen additive-profile job without claiming it or blocking an existing v1 job',async()=>{
 const {root,store}=fixture();const legacy=store.upsertPending(payload,1);
 const ownerBinding={protocol:'ordinary_initial_plan_additive_v1' as const,projectId:'future',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'new-contract-create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1 as const,
  acceptanceSchemaVersion:1 as const,semanticSchemaVersion:1 as const,handlerDigest:'e'.repeat(64),writerFloorDigest:'f'.repeat(64)};
 const additive=store.upsertPending({...payload,projectId:'future',ownerBinding},1);
 const reopened=new JsonKSwarmInitialPlanBootstrapStore(root);expect(reopened.list()).toEqual([legacy,additive]);
 const calls:string[]=[];const queue=new KSwarmInitialPlanBootstrapQueue(reopened,async job=>{calls.push(job.projectId);return {ok:true};},{setTimeoutFn:()=>({unref(){}} as unknown as NodeJS.Timeout)});
 try{await queue.runOnce();await queue.runOnce();expect(calls).toEqual(['p']);expect(reopened.list()[1]).toEqual(additive);expect(reopened.nextDueAt(1e9)).toBeNull();}
 finally{queue.stopAccepting();await queue.drain();}
});
it('freezes every additive owner contract field in original payload hash and rejects unknown/downgraded contracts',()=>{
 const {root,store}=fixture();const ownerBinding={protocol:'ordinary_initial_plan_additive_v1' as const,projectId:'p',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'new-create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1 as const,
  acceptanceSchemaVersion:1 as const,semanticSchemaVersion:1 as const,handlerDigest:'e'.repeat(64),writerFloorDigest:'f'.repeat(64)};
 const job=store.upsertPending({...payload,ownerBinding},1);
 for(const field of ['handlerDigest','writerFloorDigest'] as const)expect(()=>store.upsertPending({...payload,ownerBinding:{...ownerBinding,[field]:'0'.repeat(64)}},2)).toThrow('bootstrap_payload_conflict');
 expect(()=>store.upsertPending({...payload,ownerBinding:{...ownerBinding,unrecognizedControl:true} as typeof ownerBinding},2)).toThrow('bootstrap_owner_binding_invalid');
 expect(()=>store.upsertPending({...payload,ownerBinding:{...ownerBinding,semanticSchemaVersion:2} as unknown as typeof ownerBinding},2)).toThrow('bootstrap_owner_binding_invalid');
 const data={revision:1,jobs:[{...job,ownerBinding:{...ownerBinding,protocol:'ordinary_initial_plan_v1'}}]};writeFileSync(join(root,'kswarm-initial-plan-bootstrap-jobs.json'),JSON.stringify(data));
 expect(()=>store.list()).toThrow('bootstrap_identity_invalid');
});

it('refuses new-profile enqueue without any journal write and rejects direct execution before HTTP/model',async()=>{
 const {root,store}=fixture();const ownerBinding={protocol:'ordinary_initial_plan_additive_v1' as const,projectId:'p',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1 as const,
  acceptanceSchemaVersion:1 as const,semanticSchemaVersion:1 as const,handlerDigest:'e'.repeat(64),writerFloorDigest:'f'.repeat(64)};
 const initial=store.upsertPending({...payload,ownerBinding},1),path=join(root,'kswarm-initial-plan-bootstrap-jobs.json'),before=readFileSync(path,'utf8');let effects=0;
 const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{effects++;return {ok:true};});
 try{expect(queue.enqueue({...payload,ownerBinding})).toEqual({ok:false,error:'bootstrap_owner_protocol_unqualified'});expect(readFileSync(path,'utf8')).toBe(before);await queue.runOnce();expect(effects).toBe(0);}
 finally{queue.stopAccepting();await queue.drain();}
 const durable={...initial,status:'running' as const,claimToken:'held-original-token',modelAttempted:true as const};writeFileSync(path,JSON.stringify({revision:2,jobs:[durable]}));
 const raw=readFileSync(path,'utf8');
 const result=await executeOwnedInitialPlanBootstrap({...durable,ownerBinding:{...durable.ownerBinding,protocol:'ordinary_initial_plan_v1'} as typeof durable.ownerBinding},{store,scope:{profileId:ownerBinding.profileId,workspaceId:ownerBinding.workspaceId},gateway:{getDesktopMutationToken:()=>{effects++;return 'test-token';},async request(){effects++;throw Error('HTTP must remain closed');}},async generateCandidate(){effects++;throw Error('model must remain closed');}},new AbortController().signal);
 expect(result).toEqual({ok:false,error:'bootstrap_owner_protocol_unqualified'});expect(effects).toBe(0);expect(readFileSync(path,'utf8')).toBe(raw);
 expect(()=>store.recordModelAttempt('p',durable.claimToken)).toThrow('bootstrap_owner_protocol_unqualified');
});
it('reads the actual pre-reader production fixture byte-for-byte without changing v1 identity',()=>{
 const {root,store}=fixture();const frozen=JSON.parse(readFileSync(new URL('../fixtures/kswarm-bootstrap-pre-additive-v1.json',import.meta.url),'utf8'));
 expect(frozen.sourceSha256).toBe('d251c866c811195e586f4f58c77f1aaf35dd23a7d9920bdde90959fecdbd0011');
 const path=join(root,'kswarm-initial-plan-bootstrap-jobs.json');writeFileSync(path,JSON.stringify(frozen.journal));const before=readFileSync(path,'utf8');
 expect(store.list()).toEqual(frozen.journal.jobs);expect(store.upsertPending(frozen.input,999)).toEqual(frozen.journal.jobs[0]);expect(readFileSync(path,'utf8')).toBe(before);
});
