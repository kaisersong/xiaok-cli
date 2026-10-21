import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const scenario=process.argv[2]??'held';assert.ok(['held','lost','cancelled','fork'].includes(scenario));
const repo=process.cwd(),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'solpi-cli-goal-native-'))),config=path.join(root,'config'),sessionId=randomUUID();
const profileSetup=path.join(repo,'tests/support/profile-account-child.setup.mjs');process.env.HOME=root;process.env.USERPROFILE=root;process.env.XIAOK_TEST_ACCOUNT_HOME=root;await import(profileSetup);
fs.mkdirSync(config);
fs.writeFileSync(path.join(config,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'local-fixture-key'}},models:{current:{provider:'deepseek',model:'deepseek-chat',label:'Fixture'}},defaultMode:'interactive'}));
const definition=path.join(root,'definition.json');fs.writeFileSync(definition,JSON.stringify({version:1,obligations:[{obligationId:'original',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]}));
const forkMode=path.join(root,'fork-mode');
const trace=path.join(root,'trace.jsonl'),release=path.join(root,'release'),goalPath=path.join(config,'goals',`${sessionId}.goal.json`),entry=path.join(repo,'src/index.ts'),loader=path.join(root,'loader.mjs');
fs.writeFileSync(loader,`
import fs from 'node:fs';import {registerHooks} from 'node:module';
const scenario=${JSON.stringify(scenario)},remotePath=${JSON.stringify(path.join(root,'authority-state.json'))},trace=${JSON.stringify(trace)},release=${JSON.stringify(release)};
const record=(kind,data={})=>fs.appendFileSync(trace,JSON.stringify({kind,...data})+'\\n');
registerHooks({resolve(spec,ctx,next){for(const name of ['installed-owner-state','controller-client','crash-reporter'])if(spec.endsWith('/'+name+'.js')||spec.endsWith('/'+name+'.ts'))return{url:'goal-native-fixture:'+name,shortCircuit:true};return next(spec,ctx);},load(url,ctx,next){
 if(url==='goal-native-fixture:installed-owner-state')return{format:'module',shortCircuit:true,source:'export const readInstalledCurrentOwner=(owner)=>globalThis.__goalNative.ownerState(owner);'};
 if(url==='goal-native-fixture:crash-reporter')return{format:'module',shortCircuit:true,source: 'export * from '+JSON.stringify(${JSON.stringify('file://'+path.join(repo,'src/utils/crash-reporter.ts')+'?native-smoke-original')})+'; import {reportCrash as original} from '+JSON.stringify(${JSON.stringify('file://'+path.join(repo,'src/utils/crash-reporter.ts')+'?native-smoke-original')})+';export async function reportCrash(error){globalThis.__goalNativeError(error);return original(error);}'};
 if(url==='goal-native-fixture:controller-client')return{format:'module',shortCircuit:true,source:'export const createInstalledVerificationClient=()=>globalThis.__goalNative.client();'};
 return next(url,ctx);
}});
const {FileSessionStore}=await import(${JSON.stringify('file://'+path.join(repo,'src/ai/runtime/session-store/file-store.ts'))});
const {goalRegistrationHash}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/verification/owner-enrollment-review.ts'))});
const {goalApplicationBindingHash}=await import(${JSON.stringify('file://'+path.join(repo,'src/runtime/verification/goal-application-binding.ts'))});
const remote=()=>fs.existsSync(remotePath)?JSON.parse(fs.readFileSync(remotePath,'utf8')):{enrolled:false,bound:false};const save=r=>fs.writeFileSync(remotePath,JSON.stringify(r));
const owner=()=>({profileId:'profile',ownerKind:'goal',ownerId:remote().enrollment.canonicalReview.enrollment.ownerId});
const base={version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}};
const observation=()=>{const binding=remote().application.canonicalReview.binding;return {state:'active',current:{binding,bindingHash:goalApplicationBindingHash(binding),revision:1},pendingTransitionId:null,pendingTarget:null};};
async function call(method,payload){record(method);let r=remote();
 if(method==='completion.read-goal-fork-source'){const application=r.application.canonicalReview.binding,registration=r.enrollment.canonicalReview.registration;return {source:{authorityId:'authority',owner:owner(),sessionId:application.sessionId,applicationHash:goalApplicationBindingHash(application),registrationHash:goalRegistrationHash(registration),obligationSetHash:'b'.repeat(64),dependencies:[]},registration,application};}
 if(method==='completion.prepare-owner-request'){const {requestId,...proposal}=payload;r.enrollment={challengeId:'enroll',canonicalReview:{...base,purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}};save(r);if(scenario!=='lost'&&scenario!=='fork')while(!fs.existsSync(release))await new Promise(r=>setTimeout(r,20));return {created:true,challenge:r.enrollment};}
 if(method==='completion.authorize-owner'){r.enrolled=true;save(r);if(scenario==='lost'&&!r.lost){r.lost=true;save(r);throw Error('fixture_reply_lost');}return {owner:owner(),readGrant:{id:'read',secret:'a'.repeat(64)}};}
 if(method==='completion.recover-owner-request')return r.enrolled?{state:'committed',owner:owner(),challenge:r.enrollment}:r.enrollment?{state:'not_approved',challenge:r.enrollment}:{state:'not_prepared'};
 if(method==='application.prepareRequest'){r.application={challengeId:'apply',alreadyCommitted:false,canonicalReview:{...base,purpose:'completion-application-binding',challengeId:'apply',requestSource:'user',owner:owner(),registrationHash:'a'.repeat(64),previousBindingHash:null,binding:payload.binding,bindingHash:goalApplicationBindingHash(payload.binding)}};save(r);return {created:true,challenge:r.application};}
 if(method==='application.authorize'){r.bound=true;save(r);const {pendingTarget,...reply}=observation();return reply;}
 if(method==='application.recoverRequest')return r.bound?{state:'committed',challengePhase:'committed',challenge:{...r.application,alreadyCommitted:true},observation:observation()}:{state:'not_prepared'};
 if(method==='application.inspect')return observation();
 throw Error('fixture unsupported '+method);
}
globalThis.__goalNativeError=error=>record('crash',{message:String(error),stack:error?.stack});
globalThis.__goalNative={ownerState:raw=>remote().enrolled&&raw.ownerKind==='goal'?{kind:'protected-unregistered',authorityId:'authority',owner:owner()}:{kind:'ordinary'},client:()=>({completionTransport:{call,callSync(){throw Error('unused');}},applicationTransport:{call},dispose(){}})};
const sessionId=${JSON.stringify(sessionId)},config=${JSON.stringify(config)},store=new FileSessionStore(config+'/sessions');if(!await store.load(sessionId)){const now=Date.now();await store.save({sessionId,cwd:${JSON.stringify(root)},createdAt:now,updatedAt:now,lineage:[sessionId],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});}
globalThis.fetch=async(url,init)=>{if(!String(url).startsWith('https://api.deepseek.com/')){record('aux-fetch',{url:String(url)});throw Error('fixture blocks non-model network');}record('fetch',{url:String(url)});await new Promise(r=>setTimeout(r,1000));return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Actual CLI SDK boundary'},finish_reason:null}]})+'\\n\\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});};
process.argv=[process.execPath,${JSON.stringify(entry)},'chat','--auto',fs.existsSync(${JSON.stringify(forkMode)})?'--fork-session':'--resume',sessionId,'--goal-verification',${JSON.stringify(definition)}];await import(${JSON.stringify('file://'+entry)});
`);
const pty=createRequire(path.join(repo,'package.json'))('node-pty');let output='',exited=false,child;
function launch(){output='';exited=false;child=pty.spawn(process.execPath,['--import',profileSetup,'--import',path.join(repo,'node_modules/tsx/dist/loader.mjs'),loader],{cwd:root,env:{...process.env,XIAOK_CONFIG_DIR:config,XIAOK_MODEL_RECOVERY_WINDOW_MS:'0',TERM:'xterm-256color'},cols:120,rows:35});child.onData(t=>{output+=t;fs.appendFileSync(path.join(root,'terminal.txt'),t);});child.onExit(()=>{exited=true;});}
const rows=()=>fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const doc=()=>fs.existsSync(goalPath)?JSON.parse(fs.readFileSync(goalPath,'utf8')):null;
const mutation=()=>{const dir=path.join(config,'goals');if(!fs.existsSync(dir))return null;const records=fs.readdirSync(dir).filter(f=>f.endsWith('.native-goal.json')).flatMap(file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')).records);return records.find(row=>row.kind==='fork')??records.at(-1)??null;};
async function until(label,test,timeout=20000){const start=Date.now();while(!await test()){if(exited)throw Error(label+': child exited');if(Date.now()-start>timeout)throw Error(label+': timeout');await new Promise(r=>setTimeout(r,25));}}
const send=text=>child.write(text+'\r');
async function startup(){launch();await until('interactive startup',()=>output.includes('Version:'));await new Promise(r=>setTimeout(r,500));}
let result;
try{
 await startup();send('/goal 解释原生目标');await until('preview',()=>output.includes('确认？'));send('yes');await until('original prepare',()=>rows().some(r=>r.kind==='completion.prepare-owner-request'));if(scenario!=='fork')assert.equal(doc(),null);assert.equal(rows().filter(r=>r.kind==='fetch').length,0);
 if(scenario==='fork'){
  await until('original Goal cached',()=>mutation()?.status==='applied');const original=doc();assert.equal(rows().filter(r=>r.kind==='fetch').length,0);send('/exit');await until('original exit',()=>exited);fs.writeFileSync(forkMode,'fork');await startup();await until('fork pending',()=>mutation()?.kind==='fork');const target=mutation(),targetPath=path.join(config,'goals',`${target.sessionId}.goal.json`);assert.equal(target.status,'reserved');assert.equal(fs.existsSync(targetPath),false);assert.equal(rows().filter(r=>r.kind==='completion.authorize-owner').length,1);assert.equal(rows().filter(r=>r.kind==='fetch').length,0);send('/goal native continue');await until('fork approved and cached',()=>mutation()?.status==='applied');const forked=JSON.parse(fs.readFileSync(targetPath,'utf8'));assert.equal(forked.state.forkedFromGoalId,original.state.goalId);assert.notEqual(forked.state.goalId,original.state.goalId);assert.equal(forked.state.turnsUsed,0);assert.deepEqual(forked.turns,[]);assert.deepEqual(forked.evidence,[]);assert.equal(rows().filter(r=>r.kind==='fetch').length,0);send('/goal resume');await until('fork SDK after explicit resume',()=>rows().some(r=>r.kind==='fetch'));child.write('\x1b');await new Promise(r=>setTimeout(r,1400));
 }else if(scenario==='cancelled'){
  send('/goal native cancel');await until('original request retired',()=>mutation()?.status==='retired');assert.equal(doc(),null);fs.writeFileSync(release,'release');await new Promise(r=>setTimeout(r,600));assert.equal(doc(),null);assert.equal(rows().filter(r=>r.kind==='completion.authorize-owner').length,0);assert.equal(rows().filter(r=>r.kind==='fetch').length,0);
 }else{
  if(scenario==='lost'){
   await until('lost reply visible',()=>output.includes('fixture_reply_lost'));assert.equal(mutation().status,'enrolling');send('/exit');await until('first exit',()=>exited);await startup();send('/goal native recover');await until('enrollment only recovered',()=>mutation()?.status==='enrolled');assert.equal(doc(),null);assert.equal(rows().filter(r=>r.kind==='completion.authorize-owner').length,1);assert.equal(rows().filter(r=>r.kind==='application.prepareRequest').length,0);send('/goal native continue');
  }else{
   child.write('/goal native sta');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(release,'release');
  }
  await until('Goal cached',()=>mutation()?.status==='applied');await until('explicit resume notice',()=>output.includes('输入 /goal resume'));assert.equal(doc().state.turnsUsed,0);assert.equal(rows().filter(r=>r.kind==='fetch').length,0);
  if(scenario==='held'){const start=output.length;child.write('tus\r');await until('original unsubmitted draft retained',()=>output.slice(start).includes('目标变更：applied'));assert.equal(rows().filter(r=>r.kind==='fetch').length,0);}
  send('/goal resume');await until('actual SDK after explicit resume',()=>rows().some(r=>r.kind==='fetch'));child.write('\x1b');await new Promise(r=>setTimeout(r,1400));
 }
 result={ok:true,scenario,root,sessionId,mutation:mutation()?.status,fetchCalls:rows().filter(r=>r.kind==='fetch').length,actualTty:true,leafNativeFixture:true};send('/exit');await until('exit',()=>exited);
}catch(error){result={ok:false,scenario,root,error:String(error),trace:rows().map(r=>r.kind),mutation:mutation()?.status};process.exitCode=1;}
finally{fs.writeFileSync(release,'release');await new Promise(r=>setTimeout(r,150));if(!exited)child.kill();fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
