import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {worker}=await import('./helpers/worker.mjs');
const skip=!authBinary||process.platform!=='darwin'||process.arch!=='arm64';

async function fifo(t,filename){
  const child=spawn('/usr/bin/mkfifo',['-m','600',filename],{stdio:'ignore'});
  t.diagnostic(`owned mkfifo PID ${child.pid}`);
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.deepEqual(result,{code:0,signal:null});
  assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});t.diagnostic(`owned mkfifo PID ${child.pid} reaped`);
}

for(const filename of ['auth.json','.xiaok-auth-vault-v1.lock']){
  test(`a real ${filename} FIFO cannot block original auth validation or cancellation`,{skip,timeout:15000},async t=>{
    const w=await worker(t),target=path.join(w.root,filename);
    fs.rmSync(target,{force:true});await fifo(t,target);
    const response=await w.call('account/login/start',{type:'chatgpt'},21000,800);
    assert.equal(response.result,undefined);assert.match(response.error?.message??'',/^xiaok_auth_(?:unavailable|operation_failed)$/);
    const account=await w.call('account/read',{refreshToken:false},21001,800);
    assert.ok(account.result?.account===null||account.error,'poisoned File cannot become a logged-in account');
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  });
}

test('fresh config FIFO is rejected before initialization within a bounded deadline',{skip,timeout:15000},async t=>{
  const w=await worker(t,{initializeTimeoutMs:1000,expectStartupError:true,configure:async({root})=>{
    const target=path.join(root,'config.toml');fs.rmSync(target);await fifo(t,target);
  }});
  assert.equal(w.isAlive(),false);
});

test('bare-argv AuthOwner rejects invalid config with a fixed terminal error',{skip,timeout:15000},async t=>{
  const w=await worker(t,{strictConfig:false,expectStartupError:true,configure:({root})=>{
    fs.writeFileSync(path.join(root,'config.toml'),'cli_auth_credentials_store = "SYNTHETIC_INVALID_STORE_CANARY"\n',{mode:0o600});
  }});
  assert.equal(w.isAlive(),false);assert.ok(!w.diagnostics().includes('SYNTHETIC_INVALID_STORE_CANARY'));
});

test('local config syntax errors cannot disclose source text through internal or terminal diagnostics',{skip,timeout:15000},async t=>{
  const canary='SYNTHETIC_LOCAL_SYNTAX_CANARY';
  const w=await worker(t,{strictConfig:false,expectStartupError:true,diagnosticLevel:'trace',configure:({root})=>{
    fs.writeFileSync(path.join(root,'config.toml'),`model = "${canary}\n`,{mode:0o600});
  }});
  assert.ok(!w.diagnostics().includes(canary));assert.ok(!w.rawStdout().includes(canary));
});

test('an existing genuine birth with auth FIFO is rejected before initialization within a bounded deadline',{skip,timeout:15000},async t=>{
  const first=await worker(t);
  assert.deepEqual(await first.endAndDrain(),{code:0,signal:null});
  await fifo(t,path.join(first.root,'auth.json'));
  const w=await worker(t,{existingRoot:first.root,initializeTimeoutMs:1000,expectStartupError:true});
  assert.equal(w.isAlive(),false);
});

test('the original success HTTP route cannot complete a login without the original committed operation',{skip,timeout:15000},async t=>{
  const w=await worker(t),login=await w.call('account/login/start',{type:'chatgpt'});assert.equal(login.error,undefined);
  const authUrl=new URL(login.result.authUrl),callback=new URL(authUrl.searchParams.get('redirect_uri'));
  const response=await fetch(new URL('/success',callback.origin),{signal:AbortSignal.timeout(2000)});await response.text();
  const complete=await w.waitFor(frame=>frame.method==='account/login/completed'&&frame.params?.loginId===login.result.loginId);
  assert.equal(complete.params.success,false,'an unauthenticated /success visit is not a committed login');
  assert.equal(fs.existsSync(path.join(w.root,'auth.json')),false);
  assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
  assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
});
