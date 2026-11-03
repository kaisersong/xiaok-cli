import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach,expect,it} from 'vitest';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';

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
  {setTimeoutFn:()=>({unref(){}} as unknown as NodeJS.Timeout)});
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
