import {test} from 'node:test';
import assert from 'node:assert/strict';

// This entry is never qualified by the sampling binary or by a test-only key
// provider. Actual qualification supplies the separate auth-only artifact.
const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {worker}=await import('./helpers/worker.mjs');
const skip=!authBinary||process.platform!=='darwin'||process.arch!=='arm64';

test('the actual auth owner has a distinct immutable role and refuses every sampling/configuration sibling',{skip,timeout:30000},async t=>{
 const w=await worker(t);assert.match(w.initialized.result.userAgent,/xiaok-auth-owner-v1/);
 for(const [method,params]of [
  ['thread/start',{ephemeral:true,environments:[]}],['thread/list',{}],['thread/resume',{threadId:'foreign'}],
  ['turn/start',{threadId:'foreign',input:[{type:'text',text:'never sample',text_elements:[]}]}],
  ['config/read',{includeLayers:false}],['config/value/write',{keyPath:'model',value:'foreign',mergeStrategy:'replace'}],
  ['plugin/list',{}],['mcpServerStatus/list',{}],['command/exec',{command:['/usr/bin/true']}],
  ['account/login/start',{type:'apiKey',apiKey:'SYNTHETIC_API_KEY_CANARY'}],
  ['account/login/start',{type:'chatgptAuthTokens',accessToken:'SYNTHETIC_ACCESS_CANARY',chatgptAccountId:'foreign'}],
 ]){
  const result=await w.call(method,params);assert.equal(result.error?.code,-32600,method);assert.match(result.error?.message??'',/xiaok_auth_owner_rpc_forbidden/,method);
 }
});

test('an actual empty auth owner snapshot fails closed without a token or personal credential fallback',{skip,timeout:30000},async t=>{
 const w=await worker(t),response=await w.call('xiaok/auth/snapshot',{refresh:false});
 assert.equal(response.result,undefined);assert.match(response.error?.message??'',/^xiaok_auth_unavailable$/);
 const account=await w.call('account/read',{refreshToken:false});assert.equal(account.error,undefined);assert.equal(account.result.account,null);
});


test('private auth RPC requires original initialization and exact object-only parameters',{skip,timeout:30000},async t=>{
 const w=await worker(t,{beforeInitialize:async({call})=>{
  const result=await call('xiaok/auth/snapshot',{refresh:false});
  assert.equal(result.result,undefined);assert.match(result.error?.message??'',/^xiaok_auth_owner_rpc_forbidden$/);
 }});
 for(const params of [null,[],{refresh:null},{refresh:'true'},{unknown:null},{accessToken:'SYNTHETIC_PARAM_CANARY'}]){
  const response=await w.call('xiaok/auth/snapshot',params);
  assert.equal(response.result,undefined);assert.equal(response.error?.message,'xiaok_auth_invalid_params');assert.ok(!JSON.stringify(response).includes('CANARY'));
 }
 for(const params of [{},{refresh:false},{refresh:true}]){
  const result=await w.call('xiaok/auth/snapshot',params);assert.equal(result.error?.message,'xiaok_auth_unavailable');
 }
});

test('auth-only browser callback errors never copy provider descriptions into stderr, UI or public replies',{skip,timeout:30000},async t=>{
 const w=await worker(t),login=await w.call('account/login/start',{type:'chatgpt'});
 assert.equal(login.error,undefined);assert.equal(login.result.type,'chatgpt');
 const authUrl=new URL(login.result.authUrl);assert.equal(authUrl.protocol,'https:');
 const callback=new URL(authUrl.searchParams.get('redirect_uri'));
 assert.equal(callback.protocol,'http:');assert.ok(['localhost','127.0.0.1','[::1]'].includes(callback.hostname));assert.equal(callback.pathname,'/auth/callback');
 callback.searchParams.set('state',authUrl.searchParams.get('state'));
 callback.searchParams.set('error','access_denied');callback.searchParams.set('error_description','SYNTHETIC_CALLBACK_SECRET_CANARY');
 const response=await fetch(callback,{redirect:'manual'});const body=await response.text();
 assert.equal(response.status,200);
 const completion=await w.waitFor(m=>m.method==='account/login/completed'&&m.params?.loginId===login.result.loginId);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(completion.params.success,false);
 const exposed=JSON.stringify({body,completion,stderr:w.diagnostics()});
 t.diagnostic(JSON.stringify({case:'original-browser-callback',uiLeaks:body.includes('SYNTHETIC_CALLBACK_SECRET_CANARY'),notificationLeaks:JSON.stringify(completion).includes('SYNTHETIC_CALLBACK_SECRET_CANARY'),stderrLeaks:w.diagnostics().includes('SYNTHETIC_CALLBACK_SECRET_CANARY')}));
 assert.ok(!exposed.includes('SYNTHETIC_CALLBACK_SECRET_CANARY'),'provider description must not enter UI, stderr or auth notification');
});


test('AuthOwner lifetime request IDs survive response consumption and close the original gate on reuse',{skip,timeout:30000},async t=>{
 const w=await worker(t);
 const duplicate=await w.call('xiaok/auth/snapshot',{refresh:false},w.initialized.id);
 assert.equal(duplicate.error?.message,'xiaok_auth_request_id_rejected');assert.equal(duplicate.result,undefined);
 await assert.rejects(w.call('xiaok/auth/snapshot',{refresh:false},9999,200),/native_response_timeout/);
 assert.equal(w.isAlive(),true);t.diagnostic('original closed gate dropped the later snapshot RPC; native process remained alive');
 const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});assert.equal(w.transcript.some(frame=>frame.id===9999),false);t.diagnostic('stdin write completed, then EOF, native exit 0 and stdout EOF: no late probe response');
});

test('AuthOwner request ID byte budget closes the original gate and logout keeps its original null semantics',{skip,timeout:30000},async t=>{
 const w=await worker(t),logout=await w.call('account/logout',null);assert.equal(logout.error,undefined);
 const bounded=await w.call('xiaok/auth/snapshot',{},'x'.repeat(128));assert.equal(bounded.error?.message,'xiaok_auth_unavailable');
 const oversized=await w.call('xiaok/auth/snapshot',{},'x'.repeat(129));assert.equal(oversized.error?.message,'xiaok_auth_request_id_rejected');
 await assert.rejects(w.call('account/read',{refreshToken:false},9999,200),/native_response_timeout/);assert.equal(w.isAlive(),true);t.diagnostic('original closed gate dropped the later account RPC; native process remained alive');
 const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});assert.equal(w.transcript.some(frame=>frame.id===9999),false);t.diagnostic('stdin write completed, then EOF, native exit 0 and stdout EOF: no late probe response');
});

test('AuthOwner out-of-namespace request ID keeps the fixed rejection frame bounded and stays alive until real EOF',{skip,timeout:30000},async t=>{
 const w=await worker(t);
 // 1,048,500 bytes keeps the raw input line inside the 1 MiB reader budget;
 // echoing such an ID verbatim would push the fixed error frame past that
 // budget and force an early physical close before the real stdin EOF.
 const frameBusting='y'.repeat(1048500);
 w.send({id:frameBusting,method:'xiaok/auth/snapshot',params:{}});
 const rejection=await w.waitFor(frame=>frame.error?.message==='xiaok_auth_request_id_rejected'&&frame.id==='');
 assert.equal(rejection.id,'');
 await assert.rejects(w.call('account/read',{refreshToken:false},9999,200),/native_response_timeout/);
 assert.equal(w.isAlive(),true);
 const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});
 assert.equal(w.transcript.some(frame=>frame.id===9999),false);
 t.diagnostic(JSON.stringify({case:'out-of-namespace-id-bounded-rejection',requestIdBytes:1048500,rejectionIdEmpty:true,gateClosedAfterRejection:true,aliveUntilRealEof:true}));
});

test('AuthOwner raw reader frame budget applies per complete line, not across adjacent legal frames',{skip,timeout:30000},async t=>{
 const w=await worker(t);
 // A legal request line kept just inside the 1 MiB per-line budget, sent
 // without its newline so the reader accumulates it as an incomplete tail;
 // the newline then arrives together with a second short legal request in a
 // later read chunk. Summing adjacent complete lines into the frame budget
 // would close the connection here; each line is legal on its own.
 const frameOf=pad=>JSON.stringify({id:'long-but-legal-line',method:'account/read',params:{refreshToken:false,pad}});
 const target=1024*1024-8;
 const base=frameOf('p').length-1;
 const line=frameOf('p'.repeat(target-1-base));
 assert.equal(line.length+1,target,'the first line must sit inside the per-line budget');
 w.writeRaw(line);
 await new Promise(resolve=>setTimeout(resolve,300));
 w.writeRaw('\n'+JSON.stringify({id:'short-after-long-line',method:'account/read',params:{refreshToken:false}})+'\n');
 const first=await w.waitFor(frame=>frame.id==='long-but-legal-line');
 const second=await w.waitFor(frame=>frame.id==='short-after-long-line');
 assert.ok(first.result!==undefined||first.error!==undefined,'the withheld-newline line must still be parsed and answered');
 assert.ok(second.result!==undefined||second.error!==undefined);
 assert.equal(w.isAlive(),true);
 const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});
 t.diagnostic(JSON.stringify({case:'adjacent-legal-lines-not-summed',firstLineBytes:target,bothAnswered:true,aliveUntilRealEof:true}));
});
