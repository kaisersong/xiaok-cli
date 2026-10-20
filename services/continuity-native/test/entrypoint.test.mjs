import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {binary,nativeSkip} from './helpers/worker.mjs';

test('dedicated binary rejects helper aliases and helper argv before upstream arg0 dispatch',{skip:nativeSkip,timeout:40000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-native-entry-'));fs.chmodSync(root,0o700);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:3}));
  for(const variant of [{args:['--codex-run-as-apply-patch','INVALID_PATCH']},{args:['INVALID_PATCH'],argv0:'apply_patch'}]){
    const child=spawn(binary,variant.args,{argv0:variant.argv0,cwd:root,env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe'],detached:true});
    fs.writeFileSync(path.join(root,`owned-${child.pid}.json`),JSON.stringify({pid:child.pid,variant}));
    t.diagnostic(`owned helper-boundary PID ${child.pid}`);
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},15000);
    const result=await new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});clearTimeout(timer);
    assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});assert.throws(()=>process.kill(-child.pid,0),{code:'ESRCH'});
    t.diagnostic(`owned helper-boundary PID ${child.pid} reaped`);
    assert.notEqual(result.code,0);assert.match(stdout+stderr,/xiaok_native_entrypoint_forbidden/);
    assert.doesNotMatch(stdout+stderr,/Invalid patch|patch must begin/i,'upstream patch parser must never run');
  }
});
