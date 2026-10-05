import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const scenario=process.argv[2]??'held';assert.ok(['held','lost','cancelled'].includes(scenario));
const repo=process.cwd(),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'solpi-cli-goal-publication-'))),config=path.join(root,'config'),sessionId=randomUUID();
const profileSetup=path.join(repo,'tests/support/profile-account-child.setup.mjs');process.env.HOME=root;process.env.USERPROFILE=root;process.env.XIAOK_TEST_ACCOUNT_HOME=root;await import(profileSetup);
fs.mkdirSync(config);
fs.writeFileSync(path.join(config,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'local-fixture-key'}},models:{current:{provider:'deepseek',model:'deepseek-chat',label:'Fixture'}},defaultMode:'interactive'}));
const trace=path.join(root,'trace.jsonl'),release=path.join(root,'release'),goalPath=path.join(config,'goals',`${sessionId}.goal.json`),entry=path.join(repo,'src/index.ts');
const loader=path.join(root,'loader.mjs');
fs.writeFileSync(loader,`
import fs from 'node:fs';import {registerHooks} from 'node:module';import {createHash} from 'node:crypto';
const scenario=${JSON.stringify(scenario)},remotePath=${JSON.stringify(path.join(root,'publisher-state.json'))};
const trace=${JSON.stringify(trace)},goalPath=${JSON.stringify(goalPath)},release=${JSON.stringify(release)};
const record=(kind,data={})=>fs.appendFileSync(trace,JSON.stringify({kind,...data})+'\\n');
registerHooks({resolve(spec,ctx,next){for(const name of ['installed-owner-state','installed-goal-application','installed-completion-publication'])if(spec.endsWith('/'+name+'.js')||spec.endsWith('/'+name+'.ts'))return{url:'goal-fixture:'+name,shortCircuit:true};return next(spec,ctx);},load(url,ctx,next){
 if(url==='goal-fixture:installed-owner-state')return{format:'module',shortCircuit:true,source:'export const readInstalledCurrentOwner=(owner)=>globalThis.__goalFixture.ownerState(owner);'};
 if(url==='goal-fixture:installed-goal-application')return{format:'module',shortCircuit:true,source:'export const createInstalledGoalApplicationClient=(...args)=>globalThis.__goalFixture.application(...args);'};
 if(url==='goal-fixture:installed-completion-publication')return{format:'module',shortCircuit:true,source:'export const createInstalledCompletionPublisher=(...args)=>globalThis.__goalFixture.publisher(...args);'};
 return next(url,ctx);
}});
const {FileSessionStore}=await import(${JSON.stringify('file://'+path.join(repo,'src/ai/runtime/session-store/file-store.ts'))});
const {FileGoalStore}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/goal/file-store.ts'))});
const {GoalService}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/goal/service.ts'))});
const {GoalSessionLease}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/goal/lease.ts'))});
const {goalApplicationFromState}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/goal/completion-intent.ts'))});
const {goalApplicationBindingHash}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/verification/goal-application-binding.ts'))});
const {canonicalVerificationJson:json}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/verification/protocol.ts'))});
let active=false;const remote=()=>fs.existsSync(remotePath)?JSON.parse(fs.readFileSync(remotePath,'utf8')):{requests:[],committed:false};const writeRemote=x=>fs.writeFileSync(remotePath,JSON.stringify(x));const document=()=>JSON.parse(fs.readFileSync(goalPath,'utf8')),owner=()=>({profileId:'fixture-profile',ownerKind:'goal',ownerId:document().state.goalId});
const app=()=>{const binding=goalApplicationFromState(document().state);return{binding,bindingHash:goalApplicationBindingHash(binding),revision:1};};
const challenge=()=>({challengeId:'fixture-challenge-'+remote().requests.length,owner:owner(),fullTupleHash:'a'.repeat(64),deadline:{domainId:'fixture-clock',qualificationEpoch:1,notBefore:1,validUntil:200000}});
const observation=()=>({status:'committed',owner:owner(),operationId:'fixture-operation-'+remote().requests.length,fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'});
globalThis.__goalFixture={ownerState:raw=>active&&raw.ownerKind==='goal'?{kind:'protected-unregistered',authorityId:'fixture-authority',owner:owner()}:{kind:'ordinary'},application:()=>({inspect:async()=>({state:'active',current:app(),pendingTransitionId:null,pendingTarget:null}),dispose(){}}),publisher:(rawOwner,source)=>({
 prepareRequest:async requestId=>{record('prepare',{requestId,source});const r=remote();r.requests.push(requestId);writeRemote(r);if(scenario==='lost'&&r.requests.length===1)throw Error('fixture_prepare_response_lost');return challenge();},
 approve:async()=>{record('approve-entered',{source});if(scenario==='cancelled'&&remote().requests.length===1)return{...observation(),status:'cancelled',currentVerification:'needs_revalidation'};while(scenario==='held'&&!fs.existsSync(release))await new Promise(r=>setTimeout(r,20));writeRemote({...remote(),committed:true});record('approve-released');return observation();},
 recoverRequest:async requestId=>{record('recover',{requestId});return{status:scenario==='lost'&&remote().requests.length===1?'not_approved':'settlement_exists',owner:owner(),operationId:'fixture-operation-'+remote().requests.length,fullTupleHash:'a'.repeat(64),challenge:challenge(),challengeId:'fixture-challenge-'+remote().requests.length};},
 reconcile:async()=>observation(),observe:async()=>({owner:owner(),businessRevision:1,currentVerification:'valid',publication:remote().committed?{status:'committed',current:true,operationId:'fixture-operation-'+remote().requests.length,fullTupleHash:'a'.repeat(64)}:{status:'absent'}}),
 readPayload:async()=>{const bytes=Buffer.from(json({version:1,owner:owner(),application:app(),dependencies:[],evaluations:[]}));return{...observation(),payloadHash:createHash('sha256').update(bytes).digest('hex'),bytes};},dispose(){},
})};
const sessionId=${JSON.stringify(sessionId)},config=${JSON.stringify(config)},now=Date.now();
if(!fs.existsSync(goalPath)){await new FileSessionStore(config+'/sessions').save({sessionId,cwd:${JSON.stringify(root)},createdAt:now,updatedAt:now,lineage:[sessionId],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
const lease=new GoalSessionLease({rootDir:config+'/goal-leases',sessionId,instanceId:'seed'});lease.acquire();
try{await new GoalService({store:new FileGoalStore(config+'/goals'),ownership:{assertOwned(){lease.assertOwned();}}}).create({sessionId,instanceId:'seed',requestSource:'user',expectedRevision:null},{objective:'Give a concise answer',expectedEvidenceKinds:['answer'],turnLimit:1});}finally{lease.release();}}
active=true;let sends=0;
globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);record('fetch',{ordinal:++sends,tools:(body.tools??[]).map(t=>t.function?.name)});const delta=sends===1?{tool_calls:[{index:0,id:'goal-claim',type:'function',function:{name:'goal_request_complete',arguments:JSON.stringify({summary:'Actual CLI completed the answer'})}}]}:{content:'Actual CLI final answer'};
return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\\n\\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});};
process.argv=[process.execPath,${JSON.stringify(entry)},'chat','--auto','--resume',sessionId];await import(${JSON.stringify('file://'+entry)});
`);
const pty=createRequire(path.join(repo,'package.json'))('node-pty');let output='',exited=false;
let child;
function launch(){output='';exited=false;child=pty.spawn(process.execPath,['--import',profileSetup,'--import',path.join(repo,'node_modules/tsx/dist/loader.mjs'),loader],{cwd:root,env:{...process.env,XIAOK_CONFIG_DIR:config,XIAOK_MODEL_RECOVERY_WINDOW_MS:'0',TERM:'xterm-256color'},cols:120,rows:35});
child.onData(text=>{output+=text;fs.appendFileSync(path.join(root,'terminal.txt'),text);});child.onExit(()=>{exited=true;});}
launch();
const rows=()=>fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const doc=()=>fs.existsSync(goalPath)?JSON.parse(fs.readFileSync(goalPath,'utf8')):null;
async function until(label,test,timeout=20000){const start=Date.now();while(!await test()){if(exited)throw Error(label+': child exited');if(Date.now()-start>timeout)throw Error(label+': timeout');await new Promise(r=>setTimeout(r,25));}}
const send=command=>child.write(command+'\r');
let result;
try{
 await until('interactive startup',()=>output.includes('Version:'));await new Promise(r=>setTimeout(r,500));send('/goal resume');
 if(scenario==='held'){
 await until('native publication wait',()=>rows().some(r=>r.kind==='approve-entered'));
 const pending=doc();assert.equal(pending.state.turnsUsed,1);assert.equal(pending.state.budgetLimits.turnLimit,1);assert.ok(pending.state.pendingCompletionIntentId);assert.equal(pending.completionIntents.length,1);assert.equal(pending.turns.length,1);
 const sends=rows().filter(r=>r.kind==='fetch').length;send('/goal resume');await new Promise(r=>setTimeout(r,350));assert.equal(rows().filter(r=>r.kind==='fetch').length,sends);
 send('/goal pause');await until('pause while native held',()=>doc()?.state.status==='paused',5000);
 fs.writeFileSync(release,'release');await until('original commit facts',()=>doc()?.completionIntents?.[0]?.status==='committed');
 send('/goal publication recover');await new Promise(r=>setTimeout(r,350));assert.equal(doc().state.status,'paused');
 send('/goal publication continue');await until('publication-only complete',()=>doc()?.state.status==='complete');
 assert.equal(doc().turns.length,1);assert.equal(rows().filter(r=>r.kind==='fetch').length,sends);assert.equal(rows().filter(r=>r.kind==='approve-entered').length,1);
 }else{
 await until('first durable attempt',()=>scenario==='lost'?rows().some(r=>r.kind==='prepare'):doc()?.completionAttempts?.[0]?.status==='cancelled');
 assert.equal(doc().state.turnsUsed,1);assert.equal(doc().turns.length,1);assert.equal(doc().completionIntents.length,1);
 const first=doc().completionAttempts[0].attemptId,sends=rows().filter(r=>r.kind==='fetch').length;
 if(scenario==='lost'){
  assert.equal(doc().completionAttempts[0].status,'preparing');assert.equal(rows().filter(r=>r.kind==='approve-entered').length,0);
  send('/exit');await until('first process exit',()=>exited);launch();await until('restarted interactive startup',()=>output.includes('Version:'));await new Promise(r=>setTimeout(r,500));
  send('/goal publication recover');await until('original request retired',()=>doc()?.completionAttempts?.[0]?.status==='not_approved');
  assert.equal(rows().filter(r=>r.kind==='prepare').length,1);assert.ok(rows().filter(r=>r.kind==='recover').every(r=>r.requestId===first));assert.equal(rows().filter(r=>r.kind==='approve-entered').length,0);
 }
 send('/goal publication continue');await until('explicit retry complete',()=>doc()?.state.status==='complete');
 assert.equal(doc().completionAttempts.length,2);assert.notEqual(doc().completionAttempts[1].attemptId,first);assert.equal(doc().completionAttempts[1].requestSource,'user');
 assert.equal(doc().completionAttempts[0].status,scenario==='lost'?'not_approved':'cancelled');assert.equal(doc().completionAttempts[1].status,'committed');
 assert.equal(doc().state.turnsUsed,1);assert.equal(doc().turns.length,1);assert.equal(rows().filter(r=>r.kind==='fetch').length,sends);
 assert.equal(rows().filter(r=>r.kind==='prepare').length,2);assert.equal(rows().filter(r=>r.kind==='approve-entered').length,scenario==='lost'?1:2);
 }
 result={ok:true,scenario,root,sessionId,fetchCalls:rows().filter(r=>r.kind==='fetch').length,turnsUsed:doc().state.turnsUsed,claims:doc().completionIntents.length};send('/exit');
}catch(error){result={ok:false,root,sessionId,error:String(error),trace:rows().map(r=>r.kind),state:doc()?.state};process.exitCode=1;}
finally{fs.writeFileSync(release,'release');await new Promise(r=>setTimeout(r,150));if(!exited)child.kill();fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
