import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { waitFor } from '../support/wait-for.js';

function fixture(mode: 'model-physical-next' | 'model-physical-return' | 'model-physical-failure' | 'model-gate-preabort' | 'independent-model-abort' | 'turn-preabort' | 'update-body' | 'update-ui-error' | 'update-malformed' | 'update-cache-error' | 'update-held' | 'hook-native' | 'hook-sync' | 'hook-async' | 'event-intent_created' | 'event-stage_activated' | 'event-step_activated' | 'event-breadcrumb_emitted' | 'event-receipt_emitted' | 'event-salvage_emitted' | 'trace-error' | 'terminal-close' | 'session-save' | 'startup-save' | 'startup-failure' | 'write-failure' | 'goal-commit' | 'goal-confirmation' | 'resume-goal-failure' | 'resume-write-failure' | 'native-goal-failure' | 'login-provider' | 'login-secret' | 'login-probe' | 'login-save' | 'login-save-failure' | 'login-direct' | 'login-host' | 'login-host-preabort') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cli-finalization-race-'))), config = join(root, 'config');
  mkdirSync(config);
  writeFileSync(join(config, 'config.json'), JSON.stringify({ schemaVersion: 2, defaultProvider: 'deepseek', defaultModelId: 'current',
    providers: { deepseek: { type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com', ...(mode.startsWith('login-') ? {} : { apiKey: 'synthetic-test-key' }) } },
    models: { current: { provider: 'deepseek', model: 'deepseek-flash', label: 'Fixture' } }, defaultMode: 'interactive' }));
  const marker = join(root, 'entered'), release = join(root, 'release'), transitions = join(root, 'transitions.jsonl');
  if(mode.startsWith('hook-')){
    const plugin=join(root,'.xiaok','plugins','actual-hook');mkdirSync(plugin,{recursive:true});const script=join(root,'actual-hook.cjs');
    writeFileSync(script,`const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();fs.writeFileSync(${JSON.stringify(marker)},'actual hook entered');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);process.exit(0);}},5);`);
    const quote=(text:string)=>"'"+text.replace(/'/g,"'\\''")+"'";
    writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'actual-hook',version:'1.0.0',hooks:[{type:'command',command:`exec ${quote(process.execPath)} ${quote(script)}`,events:[mode==='hook-native'?'SessionEnd':'SessionStart'],async:mode==='hook-async',timeoutMs:20000}]}));
  }
  if(mode==='update-malformed'){mkdirSync(join(root,'.xiaok'));writeFileSync(join(root,'.xiaok','.update-check.json'),JSON.stringify({latest:42,checkedAt:Date.now()}));}
  const source = pathToFileURL(resolve('src/index.ts')).href;
  const loader = join(root, 'entry.mjs');
  writeFileSync(loader, `import fs from 'node:fs';
    import {FileSessionStore} from ${JSON.stringify(pathToFileURL(resolve('src/ai/runtime/session-store/file-store.ts')).href)};
    import {FileGoalStore} from ${JSON.stringify(pathToFileURL(resolve('src/runtime/goal/file-store.ts')).href)};
    import {InputReader} from ${JSON.stringify(pathToFileURL(resolve('src/ui/input.ts')).href)};
    const marker=${JSON.stringify(marker)}, release=${JSON.stringify(release)}, mode=${JSON.stringify(mode)};
    async function hold(){fs.writeFileSync(marker,'original-writer-entered');while(!fs.existsSync(release))await new Promise(r=>setTimeout(r,5));}
    if(mode.startsWith('hook-')){
      const Original=globalThis.AggregateError,describe=e=>e&&typeof e==='object'?{name:e.name,message:e.message,stack:e.stack,...(e instanceof Original?{errors:[...e.errors].map(describe)}:{})}:String(e);
      globalThis.AggregateError=new Proxy(Original,{construct(target,args){const error=Reflect.construct(target,args,target);fs.appendFileSync(marker+'.errors',JSON.stringify(describe(error))+'\\n');return error;}});
    }
    if(mode.startsWith('model-physical-')){
      const {OpenAIAdapter}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/adapters/openai.ts')).href)});
      OpenAIAdapter.prototype.stream=async function*(){
        if(mode!=='model-physical-return'){fs.writeFileSync(marker,'actual model next admitted');while(!fs.existsSync(release))await new Promise(r=>setTimeout(r,5));}
        try{
          if(mode==='model-physical-failure')throw Error('ORIGINAL_LATE_MODEL_FAILURE_B');
          yield {type:'text',delta:mode==='model-physical-return'?'Original completed answer.':'UNCOMMITTED_LATE_MODEL_OUTPUT'};
          yield {type:'done'};
        }finally{
          fs.writeFileSync(marker+'.closing','original model finally/return admitted');
          if(mode==='model-physical-return')fs.writeFileSync(marker,'actual original model return admitted');
          while(!fs.existsSync(release+'.closing'))await new Promise(r=>setTimeout(r,5));
          fs.writeFileSync(marker+'.closed','original model finally physically completed');
        }
      };
    }
    if(mode==='independent-model-abort'){
      const {Agent}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/agent.ts')).href)}),run=Agent.prototype.runTurn;let injected=false;
      Agent.prototype.runTurn=async function(...args){const result=await run.apply(this,args);if(!injected){injected=true;fs.writeFileSync(marker,'original Agent completed before independent failure');throw Object.assign(Error('INDEPENDENT_MODEL_FAILURE'),{name:'AbortError'});}return result;};
    }
    let inputAccepted=false;
    if(mode==='model-gate-preabort'){
      const load=FileSessionStore.prototype.load;let entered=false;
      FileSessionStore.prototype.load=async function(...args){const result=await load.apply(this,args);if(inputAccepted&&!entered){entered=true;await hold();}return result;};
      const {Agent}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/agent.ts')).href)}),run=Agent.prototype.runTurn;
      Agent.prototype.runTurn=function(...args){fs.writeFileSync(marker+'.model','actual model entry');return run.apply(this,args);};
    }
    if(mode==='turn-preabort'){
      const {Agent}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/agent.ts')).href)}),run=Agent.prototype.runTurn;
      Agent.prototype.runTurn=async function(...args){await hold();try{return await run.apply(this,args);}catch(error){fs.writeFileSync(marker+'.reason',JSON.stringify({exact:error===args[2]?.reason}));throw error;}};
    }
    if(mode==='terminal-close'){
      const {FileTranscriptLogger}=await import(${JSON.stringify(pathToFileURL(resolve('src/ui/transcript.ts')).href)});
      const record=FileTranscriptLogger.prototype.recordOutput,close=FileTranscriptLogger.prototype.close;let wrappedStdout,wrappedStderr;
      FileTranscriptLogger.prototype.recordOutput=function(...args){wrappedStdout??=process.stdout.write;wrappedStderr??=process.stderr.write;return record.apply(this,args);};
      FileTranscriptLogger.prototype.close=function(...args){fs.writeFileSync(marker,JSON.stringify({stdoutWrapped:process.stdout.write===wrappedStdout,stderrWrapped:process.stderr.write===wrappedStderr}));return close.apply(this,args);};
    }
    const {AsyncLocalStorage}=await import('node:async_hooks');const observerContext=new AsyncLocalStorage();
    if(mode.startsWith('event-')){
      const {Agent}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/agent.ts')).href)}),run=Agent.prototype.runTurn;
      Agent.prototype.runTurn=async function(...args){const result=await run.apply(this,args);observerContext.run(mode,()=>this.options.hooks.emit({type:mode.slice(6),sessionId:'original',turnId:'original-observer',intentId:'original',stepId:'original:step:1',order:1,totalStages:1,label:'original event',status:'completed',message:'original event',note:'original receipt',summary:'original salvage',reason:'original'}));return result;};
      const load=FileSessionStore.prototype.load;FileSessionStore.prototype.load=async function(...args){const result=await load.apply(this,args);if(observerContext.getStore()===mode)await hold();return result;};
      const {ScrollRegionManager}=await import(${JSON.stringify(pathToFileURL(resolve('src/ui/scroll-region.ts')).href)}),end=ScrollRegionManager.prototype.end;
      ScrollRegionManager.prototype.end=function(...args){fs.writeFileSync(marker+'.ui-ended','actual UI end');return end.apply(this,args);};
    }
    if(mode==='update-ui-error'){
      const {ScrollRegionManager}=await import(${JSON.stringify(pathToFileURL(resolve('src/ui/scroll-region.ts')).href)}),write=ScrollRegionManager.prototype.writeAtContentCursor;
      ScrollRegionManager.prototype.writeAtContentCursor=function(...args){const result=write.apply(this,args);if(String(args[0]).includes('99.0.0')){fs.writeFileSync(marker+'.ui-error','actual optional update UI error');throw Error('original optional update UI tail failed');}return result;};
    }
    if(mode==='update-cache-error'){
      const nodeFs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),write=nodeFs.writeFileSync;
      nodeFs.writeFileSync=function(...args){const result=write.apply(this,args);if(String(args[0])===${JSON.stringify(join(root,'.xiaok','.update-check.json'))}){write.call(this,marker+'.cache-error','actual cache commit error');throw Error('original optional cache committed then failed');}return result;};syncBuiltinESMExports();
    }
    if(mode==='trace-error'){
      const nodeFs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),write=nodeFs.writeFileSync;
      nodeFs.writeFileSync=function(...args){const result=write.apply(this,args);if(String(args[0]).startsWith(${JSON.stringify(join(root,'actual-traces')+'/')})&&String(args[0]).endsWith('.json')){write.call(this,marker,'actual trace commit error');throw Error('original trace committed then failed');}return result;};syncBuiltinESMExports();
    }
    const save=FileSessionStore.prototype.save;let held=false;
    FileSessionStore.prototype.save=async function(snapshot,options){const result=await save.call(this,snapshot,options);
      if(!held&&(['startup-save','startup-failure'].includes(mode)||(mode==='session-save'||mode==='write-failure')&&snapshot.messages.some(m=>m.role==='assistant'))){held=true;await hold();if(['write-failure','startup-failure'].includes(mode))throw Error('original save committed then failed');}return result;};
    const commit=FileGoalStore.prototype.commit;
    FileGoalStore.prototype.commit=async function(input){if(mode==='goal-commit'&&!held){held=true;await hold();}return commit.call(this,input);};
    const read=InputReader.prototype.read;
    InputReader.prototype.read=function(prompt,options){const original=read.call(this,prompt,options);
      if((mode.startsWith('event-')||mode.startsWith('update-')||mode==='independent-model-abort'||mode==='model-gate-preabort')&&prompt==='> ')fs.writeFileSync(marker+'.input','original input admission');
      if(mode==='model-gate-preabort'&&prompt==='> ')return original.then(value=>{inputAccepted=true;return value;});
      if(mode==='goal-confirmation'&&prompt.includes('确认')){fs.writeFileSync(marker,'original-read-entered');return original.finally(()=>fs.writeFileSync(marker+'.settled','original-read-settled'));}return original;};
    const transition=FileSessionStore.prototype.transitionIntentSessionOwnership;
    FileSessionStore.prototype.transitionIntentSessionOwnership=async function(input){fs.appendFileSync(${JSON.stringify(transitions)},JSON.stringify({action:input.action,sessionId:input.sessionId})+'\\n');return transition.call(this,input);};
    if(mode==='login-save'||mode==='login-save-failure'){
      const nodeFs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),write=nodeFs.writeFileSync;
      nodeFs.writeFileSync=function(...args){const value=write.apply(this,args);if(String(args[0])===${JSON.stringify(join(config,'config.json'))}){fs.appendFileSync(marker+'.writes','write\\n');process.emit('SIGTERM');if(mode==='login-save-failure')throw Error('original config commit then error');}return value;};syncBuiltinESMExports();
    }
    const originalFetch=globalThis.fetch;let bodyServer;
    if(mode==='update-body'){
      const http=await import('node:http');bodyServer=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{"version":');fs.writeFileSync(marker,'actual registry headers and partial body');res.once('close',()=>bodyServer.close());});
      await new Promise(r=>bodyServer.listen(0,'127.0.0.1',r));
    }
    globalThis.fetch=async(_url,init)=>{if((mode==='independent-model-abort'||mode==='model-gate-preabort')&&String(_url).includes('registry.npmjs.org'))return new Response(JSON.stringify({version:'1.0.0'}));if(mode==='update-body'&&String(_url).includes('registry.npmjs.org')){
      init.signal.addEventListener('abort',()=>fs.writeFileSync(marker+'.aborted','original request signal aborted'),{once:true});
      const response=await originalFetch('http://127.0.0.1:'+bodyServer.address().port,init),json=response.json.bind(response);
      response.json=()=>json().finally(()=>fs.writeFileSync(marker+'.body-settled','actual response body settled'));return response;
    }if(mode.startsWith('update-')&&String(_url).includes('registry.npmjs.org')){await hold();return new Response(JSON.stringify({version:'99.0.0'}),{headers:{'content-type':'application/json'}});}if(mode.startsWith('login-')){if(mode==='login-probe')await hold();return new Response(JSON.stringify({data:[{id:'original-model'}]}),{headers:{'content-type':'application/json'}});}const body=JSON.parse(init.body);if(!body.stream)return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'ORIGINAL_RUNTIME_DONE'}}]}),{headers:{'content-type':'application/json'}});
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:'ORIGINAL_RUNTIME_DONE'},finish_reason:null}]})+'\\n\\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});};
    if(mode==='resume-goal-failure'||mode==='resume-write-failure'||mode==='hook-native'){
      const {createIntentPlan}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/intent-delegation/planner.ts')).href)});
      const {createIntentNativeContractHost}=await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/intent-delegation/native-contract-host.ts')).href)});
      const {createSessionExecutionAuthority,createSessionExecutionContext}=await import(${JSON.stringify(pathToFileURL(resolve('src/ai/runtime/session-store/execution-authority.ts')).href)});
      const {intentNativeLedgerHash}=await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/intent-delegation/native-contract-journal.ts')).href)});
      const config=${JSON.stringify(config)},root=config+'/sessions',sessionId='session-earliest',store=new FileSessionStore(root);
      await store.save({sessionId,cwd:${JSON.stringify(root)},createdAt:1,updatedAt:1,lineage:[sessionId],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
      const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'previous-owner',scopeId:'actual-fixture'})});
      const host=createIntentNativeContractHost({store,authority,sessionId,instanceId:'previous-owner',assertAdmission(){}});
      const plan=createIntentPlan({sessionId,instanceId:'previous-owner',input:'请写报告，然后生成幻灯片',skills:[]});if(plan.kind!=='plan')throw Error('actual planner');
      const verification={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'result.md',sha256:'a'.repeat(64),structure:'utf8'}]}}]};
      await host.reserve({plan:plan.plan,definition:{verification,stages:plan.plan.stages.map(s=>({order:s.order,templateId:s.templateId,verification}))},requestSource:'user'});
      const lease=await authority.acquire({kind:'direct-mutation',invocationId:'initial-release'});
      try{await transition.call(store,{sessionId,instanceId:'previous-owner',expectedLedgerHash:intentNativeLedgerHash(store.getIntentNativeLedgerSync(sessionId)),action:'release',confirmHighRisk:false,requestSource:'user',now:Date.now(),lease});}finally{await lease.releaseAfterDrain();}
      await host.close();authority.dispose();if(mode!=='hook-native'){fs.mkdirSync(config+'/goals',{recursive:true});fs.writeFileSync(config+'/goals/'+sessionId+'.goal.json','{invalid original goal file');}
      FileSessionStore.prototype.transitionIntentSessionOwnership=async function(input){const result=await transition.call(this,input);fs.appendFileSync(${JSON.stringify(transitions)},JSON.stringify({action:input.action,sessionId:input.sessionId})+'\\n');
        if(input.action==='resume'&&mode==='resume-write-failure')throw Error('original ownership commit then error');return result;};
    }
    process.argv=[process.execPath,${JSON.stringify(resolve('src/index.ts'))},'chat','--auto',...(['turn-preabort','session-save','startup-save','startup-failure','write-failure','hook-sync','hook-async','trace-error'].includes(mode)?['--print','Answer a short factual question.']:['resume-goal-failure','resume-write-failure','hook-native'].includes(mode)?['--resume','session-earliest','--print','Inspect retained native state.']:[])];
    if(mode==='login-direct'||mode==='login-host'||mode==='login-host-preabort'){const {runLoginCommand}=await import(${JSON.stringify(pathToFileURL(resolve('src/commands/login.ts')).href)});const wasRaw=process.stdin.isRaw??false,listeners=process.stdin.listenerCount('data');const cancellation=new AbortController(),reason=Error('original login host cancelled');process.on('SIGTERM',()=>cancellation.abort(reason));if(mode==='login-host-preabort')cancellation.abort(reason);let outcome='saved';try{const result=mode==='login-direct'?await runLoginCommand({skipVerify:true}):await runLoginCommand({skipVerify:true},{signal:cancellation.signal,onInterrupt:()=>cancellation.abort(reason)});outcome=result.status;}catch(error){outcome=error===reason?'exact-cancel':'unknown-error';}fs.writeFileSync(marker,JSON.stringify({wasRaw,rawNow:process.stdin.isRaw??false,listeners,nowListeners:process.stdin.listenerCount('data'),...(mode==='login-direct'?{}:{outcome,nowKeypress:process.stdin.listenerCount('keypress')})}));process.exit(0);}else await import(${JSON.stringify(source)});`);
  const args = ['--import', resolve('tests/support/profile-account-child.setup.mjs'), '--import', resolve('node_modules/tsx/dist/loader.mjs'), loader];
  const env = { ...process.env, XIAOK_CONFIG_DIR: config, XIAOK_TEST_ACCOUNT_HOME: root, XIAOK_TEST_RUNTIME_HOME: mode.startsWith('update-')||(mode==='independent-model-abort'||mode==='model-gate-preabort')?root:homedir(),
    XIAOK_DISABLE_GLOBAL_PLUGINS: '1', XIAOK_MODEL_RECOVERY_WINDOW_MS: '0', TERM: 'xterm-256color' };
  if(mode==='trace-error')(env as Record<string,string>).XIAOK_TRACE_DIR=join(root,'actual-traces');
  if (mode.startsWith('login-')) { for (const key of Object.keys(env)) if (/(API.?KEY|AUTH.?TOKEN|ACCESS.?TOKEN)/i.test(key)) delete (env as Record<string,string|undefined>)[key]; }
  const session = () => {
    const directory = join(config, 'sessions');
    const name = existsSync(directory) ? readdirSync(directory).find(name => name.endsWith('.json')) : undefined;
    return name ? JSON.parse(readFileSync(join(directory, name), 'utf8')) : undefined;
  };
  const diagnostic = () => {
    if(existsSync(marker+'.errors'))return readFileSync(marker+'.errors','utf8');
    const directory = join(config, 'crashes');
    return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
      const report = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      return JSON.stringify(report.error ?? { message: report.message, stack: report.stack });
    }).join('\n') : '';
  };
  return { root, config, marker, release, transitions, args, env, session, diagnostic };
}

it.skipIf(process.platform === 'win32').each(['session-save', 'startup-save', 'startup-failure', 'write-failure'] as const)('signal holds the original %s writer before the only final ownership release', async mode => {
  const f = fixture(mode), child = spawn(process.execPath, f.args, { cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false, output = '';
  child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
  const exit = new Promise<number | null>(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  try {
    await waitFor(() => expect(existsSync(f.marker), output + f.diagnostic()).toBe(true), { timeoutMs: 20000 });
    expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
    child.kill('SIGTERM'); child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(exited, output).toBe(false);
    expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
    writeFileSync(f.release, 'finish original save');
    expect(await exit, output).toBe(['write-failure', 'startup-failure'].includes(mode) ? 1 : 143);
    expect(f.session()?.intentDelegation?.ownership.state).toBe(['write-failure', 'startup-failure'].includes(mode) ? 'owned' : 'released');
    expect(existsSync(f.transitions) ? readFileSync(f.transitions, 'utf8').trim().split('\n').map(line => JSON.parse(line).action) : []).toEqual(['write-failure', 'startup-failure'].includes(mode) ? [] : ['release']);
  } finally { writeFileSync(f.release, 'cleanup'); if (!exited) child.kill('SIGKILL'); await exit; rmSync(f.root, { recursive: true, force: true }); }
}, 30000);

it.skipIf(process.platform !== 'darwin').each(['sigterm', 'double-interrupt'] as const)('real TTY %s settles the actual Goal confirmation before finalizing ownership', async mode => {
  const f = fixture('goal-confirmation'), pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
  const child = pty.spawn(process.execPath, f.args, { cwd: f.root, env: f.env, cols: 120, rows: 30 });
  let output = '', exited = false, sent = false;
  const exit = new Promise<number>(resolve => child.onExit(event => { exited = true; resolve(event.exitCode); }));
  child.onData(text => { output += text; if (!sent && output.includes('Version:')) { sent = true; setTimeout(() => child.write('/goal create Verify an answer.\r'), 150); } });
  try {
    await waitFor(() => expect(existsSync(f.marker), output + f.diagnostic()).toBe(true), { timeoutMs: 20000 });
    if (mode === 'sigterm') process.kill(child.pid, 'SIGTERM'); else child.write('\x03\x03');
    expect(await exit, output).toBe(mode === 'sigterm' ? 143 : 0);
    expect(existsSync(f.marker + '.settled'), output).toBe(true);
    expect(f.session()?.intentDelegation?.ownership.state).toBe('released');
    expect(existsSync(join(f.config, 'goals')) ? readdirSync(join(f.config, 'goals')).filter(name => name.endsWith('.json')) : []).toEqual([]);
  } finally { if (!exited) child.kill('SIGKILL'); await exit; rmSync(f.root, { recursive: true, force: true }); }
}, 30000);

it.skipIf(process.platform !== 'darwin')('real TTY Goal commit keeps the original mutation and session ownership alive through SIGTERM', async () => {
  const f = fixture('goal-commit');
  const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
  const child = pty.spawn(process.execPath, f.args, { cwd: f.root, env: f.env, cols: 120, rows: 30 });
  let output = '', exited = false, sent = false, confirmed = false;
  const exit = new Promise<number>(resolve => child.onExit(event => { exited = true; resolve(event.exitCode); }));
  child.onData(text => {
    output += text;
    if (!sent && output.includes('Version:')) { sent = true; setTimeout(() => child.write('/goal create Verify an answer.\r'), 150); }
    if (!confirmed && output.includes('确认？输入 yes：')) { confirmed = true; child.write('yes\r'); }
  });
  try {
    await waitFor(() => expect(existsSync(f.marker), output + f.diagnostic()).toBe(true), { timeoutMs: 20000 });
    process.kill(child.pid, 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(exited, output).toBe(false);
    writeFileSync(f.release, 'finish original Goal commit');
    expect(await exit, output).toBe(143);
    expect(f.session()?.intentDelegation?.ownership.state).toBe('released');
    const goals = join(f.config, 'goals');
    expect(readdirSync(goals).some(name => name.endsWith('.json'))).toBe(true);
  } finally { writeFileSync(f.release, 'cleanup'); if (!exited) child.kill('SIGKILL'); await exit; rmSync(f.root, { recursive: true, force: true }); }
}, 30000);


it.skipIf(process.platform==='win32').each(['resume-goal-failure','resume-write-failure'] as const)('actual early bootstrap %s drains the registered ownership transition without inventing success',async mode=>{
 const f=fixture(mode),child=spawn(process.execPath,f.args,{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});
 let output='',exited=false;child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));
 const exit=new Promise<number|null>(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
 const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
 try{
  expect(await exit,output+f.diagnostic()).toBe(1);
  expect(existsSync(f.transitions),output+f.diagnostic()).toBe(true);
  const actions=readFileSync(f.transitions,'utf8').trim().split('\n').map(line=>JSON.parse(line).action);
  expect(actions).toEqual(mode==='resume-goal-failure'?['resume','release']:['resume']);
  expect(f.session()?.intentDelegation?.ownership.state).toBe(mode==='resume-goal-failure'?'released':'resume');
 }finally{clearTimeout(timer);if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},25000);


it.skipIf(process.platform !== 'darwin')('real native Goal rejection consumed by the terminal remains an exit error without ownership release', async () => {
  const f = fixture('native-goal-failure'), pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
  const child = pty.spawn(process.execPath, f.args, { cwd: f.root, env: f.env, cols: 120, rows: 30 });
  let output = '', exited = false, sent = false;
  const exit = new Promise<number>(resolve => child.onExit(event => { exited = true; resolve(event.exitCode); }));
  child.onData(text => { output += text; if (!sent && output.includes('Version:')) { sent = true; setTimeout(() => child.write('/goal native recover\r'), 150); } });
  try {
    await waitFor(() => expect(output).toContain('目标变更尚未完成'), { timeoutMs: 20000 });
    expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
    process.kill(child.pid, 'SIGTERM');
    expect(await exit, output + f.diagnostic()).toBe(1);
    expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
    expect(existsSync(f.transitions) ? readFileSync(f.transitions, 'utf8').trim() : '').toBe('');
  } finally { if (!exited) child.kill('SIGKILL'); await exit; rmSync(f.root, { recursive: true, force: true }); }
}, 30000);


it.skipIf(process.platform !== 'darwin').each(['login-provider','login-secret','login-probe','login-save','login-save-failure'] as const)('first login %s settles bootstrap through the actual CLI finalizer', async mode => {
  const f=fixture(mode),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
  const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;
  const exit=new Promise<number>(resolve=>child.onExit(event=>{exited=true;resolve(event.exitCode);}));child.onData(text=>{output+=text;});
  const timeout=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},15000);
  try{
    await waitFor(()=>expect(output,f.diagnostic()).toContain('输入编号或 provider id'),{timeoutMs:10000});
    if(mode!=='login-provider'){
      child.write('deepseek\r');await waitFor(()=>expect(output).toContain('API key（'),{timeoutMs:3000});
      if(mode!=='login-secret')child.write('synthetic-login-key\r');
    }
    if(mode==='login-probe'){
      await waitFor(()=>expect(existsSync(f.marker),output).toBe(true),{timeoutMs:3000});
      process.kill(child.pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,60));expect(exited).toBe(false);
      writeFileSync(f.release,'finish original probe');
    }else if(mode==='login-provider'||mode==='login-secret')process.kill(child.pid,'SIGTERM');
    expect(await exit,output+f.diagnostic()).toBe(mode==='login-save-failure'?1:143);
    const original=JSON.parse(readFileSync(join(f.config,'config.json'),'utf8'));
    if(mode==='login-save'||mode==='login-save-failure')expect(readFileSync(f.marker+'.writes','utf8').trim().split('\n')).toHaveLength(1);
    else expect(original.providers.deepseek.apiKey).toBeUndefined();
    expect(output).not.toContain('synthetic-login-key');
  }finally{clearTimeout(timeout);writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},20000);


it.skipIf(process.platform !== 'darwin').each(['provider','secret','default','normal-secret'] as const)('standalone login baseline preserves original %s terminal outcome and raw cleanup',async stage=>{
 const f=fixture('login-direct'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
 const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;
 const exit=new Promise<number>(resolve=>child.onExit(event=>{exited=true;resolve(event.exitCode);}));child.onData(text=>{output+=text;});
 const timeout=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},5000);
 try{
  await waitFor(()=>expect(output).toContain('输入编号或 provider id'),{timeoutMs:3000});
  if(stage!=='provider'){
   child.write('deepseek\r');await waitFor(()=>expect(output).toContain('API key（'),{timeoutMs:2000});
   if(stage!=='secret'){child.write('synthetic-login-key\r');await waitFor(()=>expect(output).toContain('切换默认模型'),{timeoutMs:2000});}
  }
  child.write(stage==='normal-secret'?'n\r':'\u0003');
  expect(await exit).toBe(stage==='secret'?130:stage==='normal-secret'?0:13);
  if(stage==='normal-secret'){ const facts=JSON.parse(readFileSync(f.marker,'utf8'));expect(facts,JSON.stringify(facts)).toEqual({wasRaw:false,rawNow:false,listeners:0,nowListeners:1});expect(output).not.toContain('synthetic-login-key'); }
 }finally{clearTimeout(timeout);if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},10000);


it.skipIf(process.platform !== 'darwin').each(['provider','secret','default','interrupt-provider','interrupt-secret','preabort','eof-provider'] as const)('host login %s settles the original prompt and restores its owned terminal resources',async stage=>{
 const f=fixture(stage==='preabort'?'login-host-preabort':'login-host'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
 const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;
 const exit=new Promise<number>(resolve=>child.onExit(event=>{exited=true;resolve(event.exitCode);}));child.onData(text=>{output+=text;});
 const timeout=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},5000);
 try{
  if(stage!=='preabort'){
   await waitFor(()=>expect(output).toContain('输入编号或 provider id'),{timeoutMs:3000});
   if(stage==='secret'||stage==='interrupt-secret'||stage==='default'){
    child.write('deepseek\r');await waitFor(()=>expect(output).toContain('API key（'),{timeoutMs:2000});
    if(stage==='default'){child.write('synthetic-login-key\r');await waitFor(()=>expect(output).toContain('切换默认模型'),{timeoutMs:2000});}
   }
   if(stage.startsWith('interrupt'))child.write('\u0003');else if(stage==='eof-provider')child.write('\u0004');else process.kill(child.pid,'SIGTERM');
  }
  expect(await exit).toBe(0);expect(existsSync(f.marker),output).toBe(true);
  const facts=JSON.parse(readFileSync(f.marker,'utf8'));expect(facts.outcome).toBe(stage==='eof-provider'?'cancelled':'exact-cancel');
  expect(facts.rawNow).toBe(facts.wasRaw);expect(facts.nowKeypress).toBe(0);if(stage==='preabort')expect(facts.nowListeners).toBe(0);else expect(facts.nowListeners).toBeLessThanOrEqual(1);
  if(stage==='preabort')expect(output).not.toContain('输入编号或 provider id');
  expect(output).not.toContain('synthetic-login-key');
 }finally{clearTimeout(timeout);if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},10000);


it.skipIf(process.platform !== 'darwin')('real TTY restores both actual transcript wrappers before the original logger closes', async () => {
 const f=fixture('terminal-close'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
 const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;
 child.onData(text=>output+=text);const exit=new Promise<number>(resolve=>child.onExit(event=>{exited=true;resolve(event.exitCode);}));
 try{await waitFor(()=>expect(output+f.diagnostic()).toContain('Version:'),{timeoutMs:20000});process.kill(child.pid,'SIGTERM');expect(await exit,output+f.diagnostic()).toBe(143);expect(JSON.parse(readFileSync(f.marker,'utf8'))).toEqual({stdoutWrapped:false,stderrWrapped:false});expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform==='win32').each(['hook-sync','hook-sync','hook-sync','hook-sync','hook-sync','hook-async'] as const)('actual configured %s remains owned until the original hook process drains',async mode=>{
 const f=fixture(mode),child=spawn(process.execPath,f.args,{cwd:f.root,env:f.env,stdio:['pipe','pipe','pipe']});let output='',exited=false;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const exit=new Promise<number|null>(r=>child.once('exit',code=>{exited=true;r(code);}));
 try{await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});child.kill('SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');writeFileSync(f.release,'actual hook finish');expect(await exit,output+f.diagnostic()).toBe(143);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;await new Promise(r=>setTimeout(r,30));rmSync(f.root,{recursive:true,force:true});}
},30000);

it.skipIf(process.platform!=='darwin').each(['intent_created','stage_activated','step_activated','breadcrumb_emitted','receipt_emitted','salvage_emitted'] as const)('actual CLI observer %s drains its whole original read and UI tail before teardown',async event=>{
 const f=fixture(`event-${event}`),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(output+f.diagnostic()).toContain('Version:'),{timeoutMs:20000});await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:20000});child.write('Answer a short factual question.\r');await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});process.kill(child.pid,'SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(existsSync(f.marker+'.ui-ended'),output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');writeFileSync(f.release,'original read finish');expect(await exit,output+f.diagnostic()).toBe(143);expect(existsSync(f.marker+'.ui-ended')).toBe(true);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);

it.skipIf(process.platform==='win32')('actual trace commit error consumed by warning still forbids ownership release',async()=>{
 const f=fixture('trace-error'),child=spawn(process.execPath,f.args,{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let output='',exited=false;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const exit=new Promise<number|null>(r=>child.once('exit',code=>{exited=true;r(code);}));
 try{expect(await exit,output+f.diagnostic()).toBe(1);expect(existsSync(f.marker),output).toBe(true);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');}
 finally{if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform==='win32')('actual existing native contract keeps configured SessionEnd behind the original dynamic gate',async()=>{
 const f=fixture('hook-native'),child=spawn(process.execPath,f.args,{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let output='',exited=false;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const exit=new Promise<number|null>(r=>child.once('exit',code=>{exited=true;r(code);}));const watchdog=setTimeout(()=>{writeFileSync(f.release,'cleanup unqualified hook');child.kill('SIGKILL');},20000);
 try{await exit;expect(existsSync(f.marker),output+f.diagnostic()).toBe(false);expect(f.session()?.intentDelegation?.nativeContracts.length).toBeGreaterThan(0);}
 finally{clearTimeout(watchdog);writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin').each(['update-held','update-cache-error'] as const)('actual delayed %s request and cache tail drain without writing a hint after ingress closes',async mode=>{
 const f=fixture(mode),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:20000});process.kill(child.pid,'SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');writeFileSync(f.release,'original registry reply');expect(await exit,output+f.diagnostic()).toBe(143);expect(output).not.toContain('99.0.0');const cache=JSON.parse(readFileSync(join(f.root,'.xiaok','.update-check.json'),'utf8'));expect(cache.latest).toBe('99.0.0');expect(cache.checkedAt).toBeGreaterThan(0);if(mode==='update-cache-error')expect(existsSync(f.marker+'.cache-error')).toBe(true);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin')('actual malformed optional update cache remains best effort during finalization',async()=>{
 const f=fixture('update-malformed'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:20000});process.kill(child.pid,'SIGTERM');expect(await exit,output+f.diagnostic()).toBe(143);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');expect(JSON.parse(readFileSync(join(f.root,'.xiaok','.update-check.json'),'utf8')).latest).toBe(42);}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin')('actual open update UI still displays its hint and remains best effort if its original UI tail fails',async()=>{
 const f=fixture('update-ui-error'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:20000});await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});writeFileSync(f.release,'original update while open');await waitFor(()=>expect(existsSync(f.marker+'.ui-error'),output+f.diagnostic()).toBe(true),{timeoutMs:2000});expect(output).toContain('99.0.0');expect(JSON.parse(readFileSync(join(f.root,'.xiaok','.update-check.json'),'utf8')).latest).toBe('99.0.0');process.kill(child.pid,'SIGTERM');expect(await exit,output+f.diagnostic()).toBe(143);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin')('actual headers-only registry body remains owned until its original five-second abort settles',async()=>{
 const f=fixture('update-body'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:20000});process.kill(child.pid,'SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');await waitFor(()=>expect(exited,output+f.diagnostic()).toBe(true),{timeoutMs:6500});expect(await exit,output).toBe(143);expect(existsSync(f.marker+'.aborted')).toBe(true);expect(existsSync(f.marker+'.body-settled')).toBe(true);expect(existsSync(join(f.root,'.xiaok','.update-check.json'))).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it('actual CLI private closing reason survives the original Agent preaborted entry',async()=>{
 const f=fixture('turn-preabort'),child=spawn(process.execPath,f.args,{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let output='',exited=false;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const exit=new Promise<number|null>(r=>child.once('exit',code=>{exited=true;r(code);}));
 const watchdog=setTimeout(()=>{writeFileSync(f.release,'cleanup');child.kill('SIGKILL');},20000);
 try{await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:15000});child.kill('SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');writeFileSync(f.release,'original Agent entry');expect(await exit,output+f.diagnostic()).toBe(143);expect(JSON.parse(readFileSync(f.marker+'.reason','utf8'))).toEqual({exact:true});expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{clearTimeout(watchdog);writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin')('actual CLI shows an independent producer AbortError as failure without a cancelled command signal',async()=>{
 const f=fixture('independent-model-abort'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 try{await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:15000});child.write('Answer a short factual question.\r');await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:15000});await waitFor(()=>expect(output).toContain('INDEPENDENT_MODEL_FAILURE'),{timeoutMs:1500});process.kill(child.pid,'SIGTERM');expect(await exit,output+f.diagnostic()).toBe(143);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{if(!exited)process.kill(child.pid,'SIGTERM');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin')('actual accepted command resumes through the closed model gate as cancellation after SIGTERM',async()=>{
 const f=fixture('model-gate-preabort'),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty'),child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false;child.onData(text=>output+=text);const exit=new Promise<number>(r=>child.onExit(e=>{exited=true;r(e.exitCode);}));
 const watchdog=setTimeout(()=>{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');},20000);
 try{await waitFor(()=>expect(existsSync(f.marker+'.input'),output+f.diagnostic()).toBe(true),{timeoutMs:15000});child.write('Answer a short factual question.\r');await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:15000});process.kill(child.pid,'SIGTERM');await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');writeFileSync(f.release,'original preparation finished');expect(await exit,output+f.diagnostic()).toBe(143);expect(output).not.toContain('chat_model_ingress_closed');expect(existsSync(f.marker+'.model')).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('released');}
 finally{clearTimeout(watchdog);writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin').each(['model-physical-next','model-physical-return','model-physical-failure'] as const)('real CLI exit retains original ownership through %s physical population',async mode=>{
 const f=fixture(mode),pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
 const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});
 let output='',exited=false,sent=false;const exit=new Promise<number>(resolve=>child.onExit(event=>{exited=true;resolve(event.exitCode);}));
 child.onData(text=>{output+=text;if(!sent&&output.includes('Version:')){sent=true;setTimeout(()=>child.write('hello physical ownership\r'),150);}});
 try{
  await waitFor(()=>expect(existsSync(f.marker),output+f.diagnostic()).toBe(true),{timeoutMs:20000});
  expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');process.kill(child.pid,'SIGTERM');
  await new Promise(r=>setTimeout(r,80));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
  writeFileSync(f.release,'supply original model next');
  await waitFor(()=>expect(existsSync(f.marker+'.closing'),output+f.diagnostic()).toBe(true),{timeoutMs:3000});
  await new Promise(r=>setTimeout(r,40));expect(exited,output).toBe(false);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
  expect(output).not.toContain('UNCOMMITTED_LATE_MODEL_OUTPUT');
  writeFileSync(f.release+'.closing','supply original model return');
  expect(await exit,output+f.diagnostic()).toBe(mode==='model-physical-failure'?1:143);expect(existsSync(f.marker+'.closed')).toBe(true);
  expect(f.session()?.intentDelegation?.ownership.state).toBe(mode==='model-physical-failure'?'owned':'released');
  if(mode==='model-physical-failure')expect(output+f.diagnostic()).toContain('ORIGINAL_LATE_MODEL_FAILURE_B');
 }finally{writeFileSync(f.release,'cleanup');writeFileSync(f.release+'.closing','cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);
