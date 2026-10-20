import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export const binary = process.env.XIAOK_NATIVE_TEST_BINARY;
export const nativeSkip = !binary || process.platform !== 'darwin' || process.arch !== 'arm64';
export const bridgeTools = [{type:'namespace',name:'xiaok',description:'Main-owned tools',tools:[{
  type:'function',name:'invoke',description:'Invoke the original main owner',
  inputSchema:{type:'object',properties:{name:{type:'string'},arguments:{type:'object'}},required:['name','arguments'],additionalProperties:false},
}]}];
export const startParams = () => ({model:'mock-model',ephemeral:true,environments:[],dynamicTools:structuredClone(bridgeTools)});

export async function worker(t,{configure,onRequest,beforeInitialize,existingRoot,expectStartupError=false,fixtureIssuer,initializeTimeoutMs=15000,expectStartupErrorPattern=/xiaok_auth_(?:vault_unavailable|unavailable)/,diagnosticLevel,faultMode,strictConfig=true,physicalStdoutPipe=false}={}) {
  const ownsRoot=existingRoot===undefined;
  const root=existingRoot??fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-native-ceiling-'));
  const workspace=path.join(root,'workspace');
  if(ownsRoot){
    fs.mkdirSync(workspace,{mode:0o700});fs.chmodSync(root,0o700);
    fs.writeFileSync(path.join(root,'config.toml'),'[features]\nshell_snapshot = false\n',{mode:0o600});
  }
  await configure?.({root,workspace});
  let issuerEnv={};
  if(diagnosticLevel){assert.ok(['warn','trace'].includes(diagnosticLevel));issuerEnv.RUST_LOG=diagnosticLevel;}
  const faultMarker=`${root}.fault.json`;
  if(faultMode){
    assert.ok(['temp-fsync','rename','dir-fsync-after-rename'].includes(faultMode));
    const library=process.env.XIAOK_AUTH_TEST_FAULT_LIBRARY;
    assert.ok(library&&path.isAbsolute(library)&&fs.statSync(library).isFile());
    Object.assign(issuerEnv,{DYLD_INSERT_LIBRARIES:library,XIAOK_TEST_FAULT_ROOT:fs.realpathSync(root),XIAOK_TEST_FAULT_MODE:faultMode,XIAOK_TEST_FAULT_MARKER:faultMarker});
  }
  if(fixtureIssuer){
    const url=new URL(fixtureIssuer);
    assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert.ok(url.port);assert.equal(url.pathname,'/');
    issuerEnv={...issuerEnv,CODEX_APP_SERVER_LOGIN_ISSUER:url.origin,CODEX_REFRESH_TOKEN_URL_OVERRIDE:`${url.origin}/oauth/token`,CODEX_REVOKE_TOKEN_URL_OVERRIDE:`${url.origin}/oauth/revoke`};
  }
  const pipeHarness=process.env.XIAOK_AUTH_TEST_STDOUT_PIPE_HARNESS;
  if(physicalStdoutPipe)assert.ok(pipeHarness&&path.isAbsolute(pipeHarness)&&fs.statSync(pipeHarness).isFile()&&strictConfig);
  const child=spawn(physicalStdoutPipe?pipeHarness:binary,physicalStdoutPipe?[binary]:strictConfig?['--strict-config']:[],{
    cwd:workspace,env:{PATH:[path.dirname(process.execPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',CODEX_HOME:root,XIAOK_NATIVE_ISOLATED_V1:'1',...issuerEnv},
    stdio:physicalStdoutPipe?['pipe','pipe','pipe','pipe']:['pipe','pipe','pipe'],detached:true,
  });
  // Fixture bookkeeping must never expand the production fresh-vault layout.
  const processRecord=`${root}.owned-${child.pid}.json`;
  fs.writeFileSync(processRecord,JSON.stringify({pid:child.pid,binary,fixtureRoot:root}),{mode:0o600});
  t.diagnostic(`owned native ceiling PID ${child.pid}, ${root}`);
  const pipeEvents=[],pipeWaiters=[];
  let pipeLines;
  if(physicalStdoutPipe){
    pipeLines=createInterface({input:child.stdio[3]});
    pipeLines.on('line',line=>{
      const event=JSON.parse(line);pipeEvents.push(event);
      if(event.event==='started'){
        fs.writeFileSync(processRecord,JSON.stringify({pid:child.pid,nativePid:event.nativePid,binary,fixtureRoot:root,actualStdoutPipe:true}),{mode:0o600});
        t.diagnostic(`owned physical native PID ${event.nativePid}, harness PID ${child.pid}`);
      }
      if(event.event==='control')pipeWaiters.shift()?.(event);
    });
  }
  function pipeControl(command){
    assert.ok(physicalStdoutPipe&&['hold','resume','status'].includes(command));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('physical_pipe_control_timeout')),3000);
      pipeWaiters.push(event=>{clearTimeout(timer);resolve(event);});child.stdio[3].write(command+'\n');
    });
  }
  let exited=false,stderr='',rawStdout='',outputOverflow=false,id=0;
  const finished=new Promise(resolve=>{
    child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});
    child.once('error',error=>{exited=true;resolve({error});});
  });
  const stdioClosed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const capture=(current,chunk)=>{const next=current+chunk.toString();if(Buffer.byteLength(next)>1024*1024){outputOverflow=true;return current;}return next;};
  child.stderr.on('data',chunk=>{stderr=capture(stderr,chunk);});
  child.stdout.on('data',chunk=>{rawStdout=capture(rawStdout,chunk);});
  const pending=new Map(),messages=[],transcript=[],waiters=new Set();
  child.once('exit',()=>{
    for(const [,resolve]of pending)resolve({error:{message:`owned_worker_exited: ${stderr}`}});
    pending.clear();
    for(const entry of waiters)entry.reject(new Error(`owned_worker_exited: ${stderr}`));
    waiters.clear();
  });
  const lines=createInterface({input:child.stdout});
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  const writeRaw=chunk=>child.stdin.write(chunk);
  function endInput(){child.stdin.end();}
  function signalNative(signal){
    assert.ok(physicalStdoutPipe&&signal==='SIGTERM');
    const actual=pipeEvents.find(event=>event.event==='started');assert.ok(actual?.nativePid);
    process.kill(actual.nativePid,signal);
  }
  lines.on('line',line=>{
    if(Buffer.byteLength(line)>1024*1024)return;
    let value;try{value=JSON.parse(line);}catch{return;}
    transcript.push(value);
    const waiter=pending.get(value.id);
    if(waiter&&!value.method){pending.delete(value.id);waiter(value);return;}
    messages.push(value);
    for(const entry of waiters)if(entry.predicate(value)){waiters.delete(entry);entry.resolve(value);}
    if(value.method&&value.id!==undefined){
      Promise.resolve().then(()=>onRequest?.(value)).then(result=>{
        send(result===undefined?{id:value.id,error:{code:-32601,message:'test_denied_unexpected_server_request'}}:{id:value.id,result});
      }).catch(()=>send({id:value.id,error:{code:-32603,message:'test_main_owner_failed'}}));
    }
  });
  t.after(async()=>{
    if(physicalStdoutPipe&&!exited)await pipeControl('resume');
    for(const [,resolve]of pending)resolve({error:{message:'owned_worker_closed'}});pending.clear();
    for(const entry of waiters)entry.reject(new Error('owned_worker_closed'));waiters.clear();
    if(!exited){
      child.stdin.end();
      const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);
      try{await finished;}finally{clearTimeout(timer);}
    }
    lines.close();
    pipeLines?.close();
    assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
    assert.throws(()=>process.kill(-child.pid,0),{code:'ESRCH'},'owned native process group must be empty');
    const native=pipeEvents.find(event=>event.event==='started');
    if(native)assert.throws(()=>process.kill(native.nativePid,0),{code:'ESRCH'},'the actual native descendant must be physically gone');
    t.diagnostic(`owned native ceiling PID ${child.pid} reaped`);
    assert.equal(outputOverflow,false,'truncated diagnostics cannot qualify an output confidentiality check');
    fs.rmSync(processRecord,{force:true});
    if(faultMode)fs.rmSync(faultMarker,{force:true});
    if(ownsRoot)fs.rmSync(root,{recursive:true,force:true,maxRetries:3});
  });
  async function call(method,params,requestId=++id,timeoutMs=15000){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`native_response_timeout ${method}: ${stderr}`));},timeoutMs);
      pending.set(requestId,value=>{clearTimeout(timer);resolve(value);});
      send({id:requestId,method,params});
    });
  }
  function waitFor(predicate){
    const existing=messages.find(predicate);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const entry={predicate,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
      const timer=setTimeout(()=>{waiters.delete(entry);reject(new Error(`native_notification_timeout: ${stderr}`));},20000);
      waiters.add(entry);
    });
  }
  await beforeInitialize?.({call});
  const initialized=await call('initialize',{clientInfo:{name:'xiaok-native-ceiling-test',version:'1'},capabilities:{experimentalApi:true}},++id,initializeTimeoutMs);
  if(expectStartupError){
    assert.ok(initialized.error,'unsafe or already-owned auth root must fail before initialization');
    const exit=await finished;await stdioClosed;
    assert.notEqual(exit.code,0,'rejection must be an actual native startup failure');
    assert.match(stderr,expectStartupErrorPattern,'a different startup failure cannot qualify the requested startup guard');
    return {root,workspace,initialized,finished,transcript,rawStdout:()=>rawStdout,diagnostics:()=>stderr,isAlive:()=>!exited};
  }
  assert.equal(initialized.error,undefined,`original worker must initialize: ${JSON.stringify(initialized)}`);
  send({method:'initialized'});
  async function endAndDrain(){
    // This callback follows every prior original stdin write, before EOF.
    if(!exited&&!pipeEvents.some(event=>event.event==='native-exit')){
      await new Promise((resolve,reject)=>child.stdin.write('',error=>error?reject(error):resolve()));
      child.stdin.end();
    }
    const result=await finished;await stdioClosed;
    if(physicalStdoutPipe){
      const actual=pipeEvents.find(event=>event.event==='native-exit');assert.ok(actual?.reaped,'the pipe harness must actually waitpid the original native');
      assert.equal(actual.signal,0,'a killed native cannot qualify graceful native output drain');
      assert.equal(actual.code,result.code,'harness and original native exit status must agree');
    }
    return result;
  }
  return {call,waitFor,messages,transcript,rawStdout:()=>rawStdout,root,workspace,initialized,finished,endAndDrain,faultMarker,pipeControl,pipeEvents,send,writeRaw,endInput,signalNative,diagnostics:()=>stderr,isAlive:()=>!exited};
}
