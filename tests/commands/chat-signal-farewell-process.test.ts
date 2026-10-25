import {expect,it} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {waitFor} from '../support/wait-for.js';

type Mode='normal'|'delay'|'throw'|'callback-error'|'held-save'|'failed-save'|'eof';
function fixture(mode:Mode){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'chat-farewell-'))),config=join(root,'config');mkdirSync(config);
 writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'synthetic-test-key'}},models:{current:{provider:'deepseek',model:'deepseek-flash',label:'Fixture'}},defaultMode:'interactive'}));
 const marker=join(root,'ready'),held=join(root,'held'),release=join(root,'release'),probe=join(root,'probe.json'),exits=join(root,'exits.jsonl'),transitions=join(root,'transitions.jsonl'),loader=join(root,'entry.mjs');
 const source=(path:string)=>JSON.stringify(pathToFileURL(resolve(path)).href);
 writeFileSync(loader,`import fs from 'node:fs';
  import {InputReader} from ${source('src/ui/input.ts')};
  import {FileSessionStore} from ${source('src/ai/runtime/session-store/file-store.ts')};
  import {FileTranscriptLogger} from ${source('src/ui/transcript.ts')};
  const mode=${JSON.stringify(mode)},marker=${JSON.stringify(marker)},held=${JSON.stringify(held)},release=${JSON.stringify(release)},probe=${JSON.stringify(probe)};
  const read=InputReader.prototype.read;
  InputReader.prototype.read=function(prompt,...rest){const pending=read.call(this,prompt,...rest);if(prompt==='> ')fs.writeFileSync(marker,'actual input admitted');return pending;};
  const save=FileSessionStore.prototype.save;let heldOnce=false;
  FileSessionStore.prototype.save=async function(snapshot,...rest){const value=await save.call(this,snapshot,...rest);if(!heldOnce&&['held-save','failed-save'].includes(mode)&&snapshot.messages.some(m=>m.role==='assistant')){heldOnce=true;fs.writeFileSync(held,'original save held');while(!fs.existsSync(release))await new Promise(r=>setTimeout(r,5));if(mode==='failed-save')throw Error('ORIGINAL_SAVE_FAILURE');}return value;};
  const transition=FileSessionStore.prototype.transitionIntentSessionOwnership;
  FileSessionStore.prototype.transitionIntentSessionOwnership=async function(input){fs.appendFileSync(${JSON.stringify(transitions)},JSON.stringify({action:input.action})+'\\n');return transition.call(this,input);};
  let transcriptNotices=0,notices=0;
  const record=FileTranscriptLogger.prototype.recordOutput;
  FileTranscriptLogger.prototype.recordOutput=function(stream,chunk){if(String(chunk).includes('已退出。'))transcriptNotices++;return record.call(this,stream,chunk);};
  const nativeWrite=process.stdout.write.bind(process.stdout),nativeExit=process.exit.bind(process);
  process.exit=function(code){fs.appendFileSync(${JSON.stringify(exits)},JSON.stringify({code,notices})+'\\n');return nativeExit(code);};
  process.stdout.write=function(chunk,...args){
   if(!String(chunk).includes('已退出。'))return nativeWrite(chunk,...args);
   notices++;const callback=typeof args.at(-1)==='function'?args.pop():undefined;
   fs.writeFileSync(probe,JSON.stringify({notices,raw:!!process.stdin.isRaw,transcriptNotices,hasCallback:!!callback}));
   if(mode==='throw')throw Error('ORIGINAL_STDOUT_THROW');
   return nativeWrite(chunk,...args,error=>{
    if(mode==='delay'){fs.writeFileSync(probe+'.native-complete','native callback completed');const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);callback?.(error);}},5);}
    else callback?.(mode==='callback-error'?Error('ORIGINAL_STDOUT_CALLBACK_ERROR'):error);
   });
  };
  if(mode==='eof'){const timer=setInterval(()=>{if(fs.existsSync(marker)&&fs.existsSync(release)){clearInterval(timer);process.stdin.push(null);}},5);}
  globalThis.fetch=async(url,init)=>String(url).includes('registry.npmjs.org')?new Response(JSON.stringify({version:'1.0.0'})):new Response('data: '+JSON.stringify({choices:[{delta:{content:'ORIGINAL_RUNTIME_DONE'},finish_reason:null}]})+'\\n\\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
  await import(${source('src/index.ts')});`);
 const args=['--import',resolve('tests/support/profile-account-child.setup.mjs'),'--import',resolve('node_modules/tsx/dist/loader.mjs'),loader,'chat','--auto'];
 const env={...process.env,XIAOK_CONFIG_DIR:config,XIAOK_TEST_ACCOUNT_HOME:root,XIAOK_TEST_RUNTIME_HOME:root,XIAOK_DISABLE_GLOBAL_PLUGINS:'1',XIAOK_MODEL_RECOVERY_WINDOW_MS:'0',TERM:'xterm-256color'};
 return {root,marker,held,release,probe,exits,args,env,
  session(){const dir=join(config,'sessions');const name=existsSync(dir)?readdirSync(dir).find(n=>n.endsWith('.json')):undefined;return name?JSON.parse(readFileSync(join(dir,name),'utf8')):undefined;},
  releases(){return existsSync(transitions)?readFileSync(transitions,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s).action):[];},
  exitCalls(){return existsSync(exits)?readFileSync(exits,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];},
 };
}
function tty(f:ReturnType<typeof fixture>){
 const pty=createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
 const child=pty.spawn(process.execPath,f.args,{cwd:f.root,env:f.env,cols:120,rows:30});let output='',exited=false,exitEvent:unknown;
 child.onData(text=>{output+=text;});const exit=new Promise<number>(resolve=>child.onExit(e=>{exited=true;exitEvent=e;resolve(e.exitCode);}));
 return {child,exit,output:()=>output,exited:()=>exited,exitEvent:()=>exitEvent,async cleanup(){writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}};
}
const notices=(output:string)=>output.match(/已退出。/g)?.length??0;

it.skipIf(process.platform!=='darwin').each(['normal','eof','delay','throw','callback-error'] as const)('actual TTY signal farewell %s respects terminal restore and native callback',async mode=>{
 const f=fixture(mode),t=tty(f);
 try{
  await waitFor(()=>expect(existsSync(f.marker),t.output()).toBe(true),{timeoutMs:20000});
  if(mode==='eof')writeFileSync(f.release,'end original native input stream');else t.child.write('\x03\x03');
  if(mode==='delay'){
   await waitFor(()=>expect(existsSync(f.probe+'.native-complete')||t.exited(),t.output()).toBe(true),{timeoutMs:20000});
   expect(existsSync(f.probe+'.native-complete'),t.output()).toBe(true);expect(t.exited()).toBe(false);
   process.kill(t.child.pid,'SIGINT');process.kill(t.child.pid,'SIGINT');await new Promise(r=>setTimeout(r,60));
   expect(t.exited(),JSON.stringify(t.exitEvent())).toBe(false);expect(notices(t.output())).toBe(1);writeFileSync(f.release,'native callback handoff');
  }
  expect(await t.exit,t.output()).toBe(mode==='throw'||mode==='callback-error'?1:0);
  expect(existsSync(f.probe),t.output()).toBe(true);
  expect(JSON.parse(readFileSync(f.probe,'utf8'))).toEqual({notices:1,raw:false,transcriptNotices:0,hasCallback:true});
  expect(f.exitCalls()).toEqual([{code:mode==='throw'||mode==='callback-error'?1:0,notices:1}]);
  expect(notices(t.output())).toBe(mode==='throw'?0:1);
  if(mode!=='throw')expect(t.output().lastIndexOf('\x1b[r')).toBeLessThan(t.output().indexOf('已退出。'));
  expect(f.session()?.intentDelegation?.ownership.state).toBe('released');expect(f.releases()).toEqual(['release']);
 }finally{await t.cleanup();}
},30000);

it.skipIf(process.platform!=='darwin').each(['SIGTERM','SIGHUP'] as const)('actual TTY %s has its original status and no success notice',async signal=>{
 const f=fixture('normal'),t=tty(f);
 try{await waitFor(()=>expect(existsSync(f.marker),t.output()).toBe(true),{timeoutMs:20000});process.kill(t.child.pid,signal);expect(await t.exit,t.output()).toBe(signal==='SIGTERM'?143:129);expect(notices(t.output())).toBe(0);expect(existsSync(f.probe)).toBe(false);expect(f.exitCalls()).toEqual([{code:signal==='SIGTERM'?143:129,notices:0}]);}finally{await t.cleanup();}
},30000);

it.skipIf(process.platform!=='darwin').each(['held-save','failed-save'] as const)('actual TTY %s cannot claim farewell before original writer drain',async mode=>{
 const f=fixture(mode),t=tty(f);
 try{
  await waitFor(()=>expect(existsSync(f.marker),t.output()).toBe(true),{timeoutMs:20000});t.child.write('write fixture\r');
  await waitFor(()=>expect(existsSync(f.held),t.output()).toBe(true),{timeoutMs:20000});t.child.write('\x03\x03');await new Promise(r=>setTimeout(r,60));
  expect(t.exited()).toBe(false);expect(notices(t.output())).toBe(0);expect(f.session()?.intentDelegation?.ownership.state).toBe('owned');
  writeFileSync(f.release,'finish original save');expect(await t.exit,t.output()).toBe(mode==='failed-save'?1:0);
  expect(notices(t.output())).toBe(mode==='failed-save'?0:1);expect(f.exitCalls()).toEqual([{code:mode==='failed-save'?1:0,notices:mode==='failed-save'?0:1}]);
  expect(f.session()?.intentDelegation?.ownership.state).toBe(mode==='failed-save'?'owned':'released');expect(f.releases()).toEqual(mode==='failed-save'?[]:['release']);
 }finally{await t.cleanup();}
},30000);

it.skipIf(process.platform==='win32').each(['print','json'] as const)('actual noninteractive %s signal exits without an interactive farewell',async mode=>{
 const f=fixture('held-save'),child=spawn(process.execPath,[...f.args,`--${mode}`,'fixture input'],{cwd:f.root,env:f.env,stdio:['ignore','pipe','pipe']});let output='',exited=false;
 child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});const exit=new Promise<number|null>(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
 try{await waitFor(()=>expect(existsSync(f.held),output).toBe(true),{timeoutMs:20000});child.kill('SIGINT');writeFileSync(f.release,'finish original save');expect(await exit,output).toBe(0);expect(notices(output)).toBe(0);expect(existsSync(f.probe)).toBe(false);expect(f.exitCalls()).toEqual([{code:0,notices:0}]);}
 finally{writeFileSync(f.release,'cleanup');if(!exited)child.kill('SIGKILL');await exit;rmSync(f.root,{recursive:true,force:true});}
},30000);
