import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {syntheticIssuer,oauthWorker,beginBrowser}=await import('./helpers/oauth.mjs');
const {worker}=await import('./helpers/worker.mjs');
const skip=!authBinary||!process.env.XIAOK_AUTH_TEST_FAULT_LIBRARY||process.platform!=='darwin'||process.arch!=='arm64';

for(const faultMode of ['temp-fsync','rename','dir-fsync-after-rename']){
  test(`actual original Vault ${faultMode} failure preserves physical facts, denies new authority and retains the OS lock`,{skip,timeout:20000},async t=>{
    const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth,{faultMode});
    const attempt=await beginBrowser(w);
    const response=await fetch(attempt.callback,{redirect:'manual',signal:AbortSignal.timeout(5000)});await response.text();
    assert.equal(response.status,200,'the original failed persist must return its fixed error page');
    const completed=await w.waitFor(frame=>frame.method==='account/login/completed'&&frame.params?.loginId===attempt.loginId);
    assert.equal(completed.params.success,false);
    assert.deepEqual(JSON.parse(fs.readFileSync(w.faultMarker,'utf8')),{injected:faultMode,renameSucceeded:faultMode==='dir-fsync-after-rename'},'the actual syscall boundary must be reached');
    const file=path.join(w.root,'auth.json');
    assert.equal(fs.existsSync(file),faultMode==='dir-fsync-after-rename','rename success is a physical fact even when subsequent dir fsync fails');
    if(fs.existsSync(file))assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).tokens.access_token,oauth.tokens.access_token);
    assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
    assert.equal((await w.call('account/login/start',{type:'chatgpt'})).error?.message,'xiaok_auth_unavailable');
    const second=await worker(t,{existingRoot:w.root,expectStartupError:true});assert.equal(second.isAlive(),false);assert.equal(w.isAlive(),true);
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
    t.diagnostic(JSON.stringify({faultMode,actualRename:faultMode==='dir-fsync-after-rename',poisoned:true,secondOwnerDenied:true}));
  });
}
