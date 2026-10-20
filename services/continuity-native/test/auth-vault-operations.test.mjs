import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {syntheticIssuer,oauthWorker,beginBrowser,completeBrowser,tokensFor}=await import('./helpers/oauth.mjs');
const skip=!authBinary||process.platform!=='darwin'||process.arch!=='arm64';

for(const status of [401,500,200,'validation','policy']){
  test(`original enterprise cloud bundle status ${status} cannot disclose synthetic response bytes`,{skip,timeout:30000},async t=>{
    const canary='SYNTHETIC_CLOUD_CONFIG_SECRET_CANARY';
    const bundleResponse=status==='validation'||status==='policy'
      ?{status:200,body:JSON.stringify({config_toml:{enterprise_managed:[{id:'synthetic-config',name:'synthetic-config',contents:status==='policy'?`model_provider = "${canary}"`:`model = "${canary}`} ]}})}
      :{status,body:`{"bad":"${canary}"`};
    const oauth=await syntheticIssuer(t,{tokenResponse:()=>tokensFor('a','enterprise'),bundleResponse});
    const w=await oauthWorker(t,oauth,{diagnosticLevel:'warn'}),attempt=await beginBrowser(w);
    const response=await fetch(attempt.callback,{redirect:'manual',signal:AbortSignal.timeout(5000)});await response.text();assert.equal(response.status,302);
    const page=await fetch(response.headers.get('location'),{signal:AbortSignal.timeout(5000)});await page.text();
    const completion=await w.waitFor(frame=>frame.method==='account/login/completed'&&frame.params?.loginId===attempt.loginId);
    assert.ok(oauth.requests.some(request=>request.path==='/backend-api/wham/config/bundle'),'actual enterprise login must reach the original bundle HTTP');
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
    const leaked=JSON.stringify({frames:w.transcript,stderr:w.diagnostics()}).includes(canary);
    t.diagnostic(JSON.stringify({case:'actual-enterprise-cloud-bundle',status,loginSuccess:completion.params.success,leaked}));
    if(leaked)t.diagnostic(JSON.stringify({syntheticOnly:true,stderr:w.diagnostics(),frames:w.messages}));
    assert.equal(leaked,false,'cloud error body must not enter native diagnostics or output');
  });
}

for(const scenario of ['policy','unknown-feature','unknown-config-feature','exact-override','permissions-warning','otel-warning']){
  test(`original enterprise ${scenario} retains policy semantics without leaking warning or startup bytes across same-birth restart`,{skip,timeout:30000},async t=>{
    const canary='SYNTHETIC_REQUIREMENT_WARNING_CANARY',source='SYNTHETIC_REQUIREMENT_SOURCE_CANARY';
    let deliver=false;
    const contents={policy:`model_provider = "${canary}"`, 'unknown-feature':`[features]\n${canary} = true\n`,'unknown-config-feature':`[features]\n${canary} = true\n`,
      'exact-override':`allow_login_shell = false\n`,
      'permissions-warning':`default_permissions = "${canary}"\n[permissions.${canary}.filesystem]\n":${canary}" = "read"\n`,
      'otel-warning':`[otel.tracestate.${canary}]\nsynthetic = "synthetic-value"\n`}[scenario];
    const kind=['unknown-feature','exact-override'].includes(scenario)?'requirements_toml':'config_toml';
    const oauth=await syntheticIssuer(t,{tokenResponse:()=>tokensFor('a','enterprise'),bundleResponse:()=>({status:200,body:JSON.stringify(deliver?{[kind]:{enterprise_managed:[{id:source,name:source,contents}]}}:{})})});
    const w=await oauthWorker(t,oauth,{diagnosticLevel:'warn',configSuffix:scenario==='exact-override'?'allow_login_shell = true\n':''});
    await completeBrowser(w,await beginBrowser(w));
    const birth=fs.statSync(path.join(w.root,'.xiaok-auth-vault-v1.lock'));
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
    fs.rmSync(path.join(w.root,'cloud-config-bundle-cache.json'),{force:true});
    deliver=true;
    const before=oauth.requests.filter(r=>r.path==='/backend-api/wham/config/bundle').length;
    const {worker}=await import('./helpers/worker.mjs');
    const denied=['policy','unknown-config-feature'].includes(scenario);
    const restarted=await worker(t,{existingRoot:w.root,fixtureIssuer:oauth.origin,diagnosticLevel:'trace',expectStartupError:denied,expectStartupErrorPattern:denied?/xiaok_auth_unavailable/:undefined});
    assert.ok(oauth.requests.filter(r=>r.path==='/backend-api/wham/config/bundle').length>before,'restart must actually fetch the changed enterprise bundle');
    assert.equal(fs.statSync(path.join(w.root,'.xiaok-auth-vault-v1.lock')).ino,birth.ino);
    if(!denied){
      assert.equal((await restarted.call('xiaok/auth/snapshot',{})).result?.accountId,'synthetic-account-a');
      assert.deepEqual(await restarted.endAndDrain(),{code:0,signal:null});
      assert.ok(restarted.messages.some(frame=>frame.method==='configWarning'),'the actual fixture must produce a warning, not a silent no-op');
    }
    const diagnostic=restarted.diagnostics(),leaked=[diagnostic,restarted.rawStdout()].some(output=>output.includes(canary)||output.includes(source));
    t.diagnostic(JSON.stringify({case:'same-birth-enterprise-restart',scenario,leaked}));
    if(leaked)t.diagnostic(JSON.stringify({syntheticOnly:true,stderr:diagnostic,frames:restarted.transcript}));
    assert.equal(leaked,false,'neither successful warnings nor terminal startup errors may contain enterprise values or source');
  });
}

test('original enterprise cache parse errors cannot disclose synthetic invalid fields',{skip,timeout:30000},async t=>{
  const canary='SYNTHETIC_CLOUD_CACHE_FIELD_CANARY';
  const oauth=await syntheticIssuer(t,{tokenResponse:()=>tokensFor('a','enterprise')});
  const w=await oauthWorker(t,oauth,{diagnosticLevel:'warn'});
  fs.writeFileSync(path.join(w.root,'cloud-config-bundle-cache.json'),JSON.stringify({signature:'synthetic',signed_payload:{version:canary}}),{mode:0o600});
  await completeBrowser(w,await beginBrowser(w));
  assert.ok(oauth.requests.some(request=>request.path==='/backend-api/wham/config/bundle'));
  assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  const leaked=JSON.stringify({frames:w.transcript,stderr:w.diagnostics()}).includes(canary);
  t.diagnostic(JSON.stringify({case:'actual-enterprise-cache-parse',leaked}));
  assert.equal(leaked,false);
});

test('original private refresh advances credentials while preserving owner, and logout survives physical restart',{skip,timeout:30000},async t=>{
  const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth);
  await completeBrowser(w,await beginBrowser(w));
  const original=(await w.call('xiaok/auth/snapshot',{})).result;assert.ok(original);
  const refreshed=await w.call('xiaok/auth/snapshot',{refresh:true});assert.equal(refreshed.error,undefined);
  assert.equal(refreshed.result.accessToken,oauth.tokens.access_token);
  assert.ok(BigInt(refreshed.result.credentialGeneration)>BigInt(original.credentialGeneration));
  assert.equal(refreshed.result.ownerGeneration,original.ownerGeneration);
  assert.ok(oauth.requests.some(request=>request.path==='/oauth/token'&&request.body.includes('refresh_token')));
  assert.equal((await w.call('account/logout',null)).error,undefined);
  assert.equal(fs.existsSync(path.join(w.root,'auth.json')),false);
  assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
  assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  const {worker}=await import('./helpers/worker.mjs');
  const restarted=await worker(t,{existingRoot:w.root,fixtureIssuer:oauth.origin});
  assert.equal((await restarted.call('account/read',{refreshToken:false})).result?.account,null);
  assert.equal((await restarted.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
  assert.deepEqual(await restarted.endAndDrain(),{code:0,signal:null});
});

for(const action of ['cancel','replace']){
  test(`the original ${action} invalidates a browser operation held in actual token HTTP`,{skip,timeout:30000},async t=>{
    let entered,release;
    const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
    const oauth=await syntheticIssuer(t,{tokenResponse:async({body})=>{
      if(body.includes('held-original-a')){entered();await held;return tokensFor('a');}return tokensFor('b');
    }});
    t.after(()=>release());
    const w=await oauthWorker(t,oauth),a=await beginBrowser(w,'held-original-a');
    const callback=fetch(a.callback,{redirect:'manual',signal:AbortSignal.timeout(8000)}).then(async r=>({status:r.status,body:await r.text()}),()=>({closed:true}));
    await Promise.race([started,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('original token HTTP not reached')),3000);timer.unref();})]);
    let b;
    if(action==='cancel'){
      const canceled=await w.call('account/login/cancel',{loginId:a.loginId});assert.equal(canceled.result?.status,'canceled');
    }else{
      b=await beginBrowser(w,'new-original-b');
    }
    release();await callback;
    const completion=await w.waitFor(frame=>frame.method==='account/login/completed'&&frame.params?.loginId===a.loginId);
    assert.equal(completion.params.success,false);
    if(b){
      await completeBrowser(w,b);
      const stored=JSON.parse(fs.readFileSync(path.join(w.root,'auth.json'),'utf8'));
      assert.equal(stored.tokens.access_token,tokensFor('b').access_token);
      const snapshot=await w.call('xiaok/auth/snapshot',{});assert.equal(snapshot.result?.accountId,'synthetic-account-b');
    }else{
      assert.equal(fs.existsSync(path.join(w.root,'auth.json')),false);
      assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
    }
    const publicOutput=JSON.stringify({messages:w.messages,stderr:w.diagnostics()});
    assert.ok(!publicOutput.includes(tokensFor('a').refresh_token));assert.ok(!publicOutput.includes(tokensFor('a').id_token));
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  });
}

for(const mutation of ['missing','same-bytes-new-inode','malformed','wide-mode','hardlink','symlink']){
  test(`actual final sender permanently denies external ${mutation}, including restored old bytes`,{skip,timeout:30000},async t=>{
    const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth);
    await completeBrowser(w,await beginBrowser(w));
    const before=await w.call('xiaok/auth/snapshot',{});assert.equal(before.result?.accessToken,oauth.tokens.access_token);
    const file=path.join(w.root,'auth.json'),saved=fs.readFileSync(file),other=path.join(w.root,'own-external-copy');
    if(mutation==='missing')fs.unlinkSync(file);
    else if(mutation==='same-bytes-new-inode'){fs.unlinkSync(file);fs.writeFileSync(file,saved,{mode:0o600});}
    else if(mutation==='malformed')fs.writeFileSync(file,'{"tokens":"SYNTHETIC_MALFORMED_JSON_CANARY"');
    else if(mutation==='wide-mode')fs.chmodSync(file,0o644);
    else if(mutation==='hardlink')fs.linkSync(file,other);
    else{fs.renameSync(file,other);fs.symlinkSync(other,file);}
    assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
    fs.rmSync(file,{force:true});fs.rmSync(other,{force:true});fs.writeFileSync(file,saved,{mode:0o600});
    assert.equal((await w.call('xiaok/auth/snapshot',{})).error?.message,'xiaok_auth_unavailable');
    assert.equal((await w.call('account/login/start',{type:'chatgpt'})).error?.message,'xiaok_auth_unavailable');
    assert.ok(!w.diagnostics().includes('SYNTHETIC_MALFORMED_JSON_CANARY'));
    assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  });
}
