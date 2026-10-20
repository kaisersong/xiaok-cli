import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {syntheticIssuer,oauthWorker,beginBrowser,completeBrowser,tokensFor}=await import('./helpers/oauth.mjs');
const skip=!authBinary||!process.env.XIAOK_AUTH_TEST_STDOUT_PIPE_HARNESS||process.platform!=='darwin'||process.arch!=='arm64';

test('original logout invalidates an already enqueued snapshot behind real kernel stdout backpressure',{skip,timeout:30000},async t=>{
  const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth,{physicalStdoutPipe:true});
  await completeBrowser(w,await beginBrowser(w));
  const started=w.pipeEvents.find(event=>event.event==='started');
  assert.ok(started?.actualPipe&&started.pipeCapacityBytes>0);
  const idFor=index=>`physical-fill-${String(index).padStart(4,'0')}-`+'p'.repeat(109);
  assert.equal(idFor(0).length,128);
  const probe=await w.call('account/read',{refreshToken:false},idFor(0));assert.ok(probe.result?.account);
  const bytesPerFrame=Buffer.byteLength(JSON.stringify(probe)+'\n');
  const fillCount=Math.ceil(started.pipeCapacityBytes/bytesPerFrame)+8;
  assert.ok(fillCount<=200,'fixture must leave room in the actual original 128+128 output queues for snapshot/logout to execute');
  assert.equal((await w.pipeControl('hold')).held,true);
  const filler=[];
  const half=Math.floor(fillCount/2);
  for(let i=1;i<=half;i++)filler.push(w.call('account/read',{refreshToken:false},idFor(i)).catch(error=>({fixtureError:error.message})));
  // Observe real native progress before sending the rest; an ingress overload
  // cannot stand in for an already queued snapshot/logout barrier.
  await eventually(async()=>{const status=await w.pipeControl('status');return status.bufferedBytes>=half*bytesPerFrame;},'the first bounded public batch must actually reach the kernel');
  for(let i=half+1;i<=fillCount;i++)filler.push(w.call('account/read',{refreshToken:false},idFor(i)).catch(error=>({fixtureError:error.message})));
  const pendingSnapshot=w.call('xiaok/auth/snapshot',{},'snapshot-before-original-logout').catch(error=>({fixtureError:error.message}));
  const logout=w.call('account/logout',null,'original-logout-after-snapshot').catch(error=>({fixtureError:error.message}));
  const authFile=path.join(w.root,'auth.json'),deadline=Date.now()+5000;
  while(fs.existsSync(authFile)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(fs.existsSync(authFile),false,'the later original account-auth logout must physically delete the real auth file while stdout is held');
  const held=await w.pipeControl('status');
  assert.ok(held.held&&held.bufferedBytes>0,'actual unread kernel bytes are required, not an artificial producer promise');
  assert.ok(fillCount*bytesPerFrame>started.pipeCapacityBytes,'preceding original public responses exceed measured actual pipe capacity');
  t.diagnostic(JSON.stringify({case:'real-kernel-stdout-backpressure',nativePid:started.nativePid,pipeCapacityBytes:started.pipeCapacityBytes,bytesPerFrame,fillCount,bufferedBytesAtRealLogout:held.bufferedBytes,realAuthFileDeleted:true}));
  await w.pipeControl('resume');
  const snapshot=await pendingSnapshot;
  assert.equal(snapshot.fixtureError,undefined,'an RPC timeout or broken fixture is not a successful last-write denial');
  await logout;await Promise.all(filler);
  const leaked=snapshot.result?.accessToken===oauth.tokens.access_token;
  t.diagnostic(JSON.stringify({case:'late-original-snapshot-after-physical-logout',leaked,snapshotHasResult:!!snapshot.result}));
  assert.equal(leaked,false,'a snapshot enqueued before real logout must be checked again at the actual kernel write');
  const exit=await w.endAndDrain();assert.equal(exit.signal,null);assert.ok(exit.code===0||exit.code===1);
  assert.ok(snapshot.error,'the original pending request must fail closed rather than disappear into a fixture fallback');
  assert.ok(w.pipeEvents.some(event=>event.event==='native-exit'&&event.reaped&&event.signal===0),'the original native must physically exit without the fixture killing it');
});

async function eventually(predicate,message,timeoutMs=5000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail(message);
}
async function holdFullPublicPipe(w){
  const started=w.pipeEvents.find(event=>event.event==='started');assert.ok(started?.actualPipe);
  const idFor=index=>`stdout-fill-${String(index).padStart(4,'0')}-`+'p'.repeat(111);
  assert.equal(idFor(0).length,128);
  const probe=await w.call('account/read',{refreshToken:false},idFor(0));assert.ok(probe.result?.account);
  const bytes=Buffer.byteLength(JSON.stringify(probe)+'\n'),count=Math.ceil(started.pipeCapacityBytes/bytes)+8;
  assert.ok(count<=200);await w.pipeControl('hold');
  const half=Math.floor(count/2);
  for(let i=1;i<=half;i++)w.send({id:idFor(i),method:'account/read',params:{refreshToken:false}});
  await eventually(async()=>{const status=await w.pipeControl('status');return status.bufferedBytes>=half*bytes;},'the initial bounded public batch must actually reach the kernel');
  for(let i=half+1;i<=count;i++)w.send({id:idFor(i),method:'account/read',params:{refreshToken:false}});
  const held=await eventually(async()=>{const status=await w.pipeControl('status');return status.bufferedBytes>=started.pipeCapacityBytes-bytes?status:null;},'real public responses must fill the actual kernel pipe');
  return {started,held,count,bytes};
}

test('zero-byte queued genuine delivery yields to the original duplicate error and stays alive until real EOF',{skip,timeout:30000},async t=>{
  const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth,{physicalStdoutPipe:true});
  await completeBrowser(w,await beginBrowser(w));
  const physical=await holdFullPublicPipe(w),snapshotId='zero-byte-snapshot';
  w.send({id:snapshotId,method:'xiaok/auth/snapshot',params:{}});
  // This later exclusive account-auth operation reaches actual synthetic HTTP
  // only after the preceding original snapshot sender has completed enqueue.
  const prior=oauth.requests.filter(r=>r.path==='/oauth/token').length;
  w.send({id:'same-original-account-queue-barrier',method:'xiaok/auth/snapshot',params:{refresh:true}});
  await eventually(()=>oauth.requests.filter(r=>r.path==='/oauth/token').length>prior,'the original later refresh must actually reach HTTP after snapshot enqueue');
  const duplicate=w.call('xiaok/auth/snapshot',{},w.initialized.id);
  // Scheduling time is not evidence of revocation. The assertions below require
  // the actual fixed error and absence of the old response in the raw FIFO.
  await new Promise(resolve=>setTimeout(resolve,100));
  await w.pipeControl('resume');
  const rejected=await duplicate;assert.equal(rejected.error?.message,'xiaok_auth_request_id_rejected');
  assert.equal(w.transcript.some(frame=>frame.id===snapshotId),false,'the zero-byte old delivery must be dropped, without even a replacement snapshot error');
  await assert.rejects(w.call('account/read',{refreshToken:false},'probe-after-queued-duplicate',200),/native_response_timeout/);
  assert.equal(w.isAlive(),true);
  const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});
  assert.equal(w.transcript.some(frame=>frame.id===snapshotId),false);
  assert.equal(w.transcript.some(frame=>frame.id==='probe-after-queued-duplicate'),false);
  assert.ok(w.pipeEvents.some(event=>event.event==='native-exit'&&event.reaped&&event.signal===0));
  t.diagnostic(JSON.stringify({case:'zero-byte-delivery-duplicate',...physical,duplicateFixedError:true,oldDeliveryAbsent:true,actualEofExit0:true}));
});

for(const close of ['duplicate','stdin-eof','sigterm'])test(`real incomplete secret prefix then ${close} closes without appending bytes or a rescue frame`,{skip,timeout:30000},async t=>{
  const tokens=tokensFor('a');tokens.access_token='SYNTHETIC_LARGE_PREFIX_'+ 's'.repeat(65536-23);
  // Keep exactly within the production token bound; never weaken it for the test.
  assert.ok(Buffer.byteLength(tokens.access_token)<=65536);
  const oauth=await syntheticIssuer(t,{tokenResponse:()=>tokens}),w=await oauthWorker(t,oauth,{physicalStdoutPipe:true});
  await completeBrowser(w,await beginBrowser(w));
  const started=w.pipeEvents.find(event=>event.event==='started');assert.ok(started?.actualPipe);
  await w.pipeControl('hold');
  const snapshotId=`partial-before-${close}`;w.send({id:snapshotId,method:'xiaok/auth/snapshot',params:{}});
  const prefix=await eventually(async()=>{const status=await w.pipeControl('status');return status.bufferedBytes>1024?status:null;},'the actual native secret write must place a real prefix in the held kernel pipe');
  assert.ok(prefix.bufferedBytes<Buffer.byteLength(tokens.access_token)+250,'fixture must actually leave an incomplete secret frame');
  if(close==='duplicate')w.send({id:w.initialized.id,method:'xiaok/auth/snapshot',params:{}});
  else if(close==='stdin-eof')w.endInput();
  else w.signalNative('SIGTERM');
  const reaped=await eventually(()=>w.pipeEvents.find(event=>event.event==='native-exit'),'the actual native must exit while the reader remains held, without fixture kill',7000);
  assert.equal(reaped.signal,0);assert.ok(reaped.code===0||reaped.code===1);assert.equal(reaped.reaped,true);
  const after=await w.pipeControl('status');assert.equal(after.bufferedBytes,prefix.bufferedBytes,'revocation must not append even a newline or duplicate error');
  await w.pipeControl('resume');await w.endAndDrain();
  const raw=w.rawStdout(),lastNewline=raw.lastIndexOf('\n'),tail=raw.slice(lastNewline+1);
  assert.ok(tail.includes('SYNTHETIC_LARGE_PREFIX_'),'the observed partial bytes must belong to the genuine snapshot');
  assert.throws(()=>JSON.parse(tail),'the physical incomplete frame remains incomplete');
  assert.equal(tail.includes('xiaok_auth_request_id_rejected'),false);
  assert.equal(w.transcript.some(frame=>frame.id===snapshotId),false);
  t.diagnostic(JSON.stringify({case:`partial-${close}`,nativePid:started.nativePid,prefixBytes:prefix.bufferedBytes,bytesAfterRevocation:after.bufferedBytes,actualWaitpid:reaped}));
});

test('ingress overload cannot bypass duplicate revocation of a genuine incomplete secret delivery',{skip,timeout:30000},async t=>{
  const tokens=tokensFor('a');tokens.access_token='SYNTHETIC_LARGE_PREFIX_'+'s'.repeat(65536-23);
  const oauth=await syntheticIssuer(t,{tokenResponse:()=>tokens}),w=await oauthWorker(t,oauth,{physicalStdoutPipe:true});
  await completeBrowser(w,await beginBrowser(w));
  await w.pipeControl('hold');
  const snapshot=w.call('xiaok/auth/snapshot',{},'partial-before-ingress-overload').catch(error=>({fixtureError:error.message}));
  const prefix=await eventually(async()=>{const status=await w.pipeControl('status');return status.bufferedBytes>1024?status:null;},'genuine snapshot must actually write its incomplete kernel prefix');
  // Original public requests have no auth mutation. All IDs are fresh except
  // the final original initialize ID. The count remains below raw line budget.
  for(let i=0;i<200;i++)w.send({id:`ingress-burst-${i}`,method:'account/read',params:{refreshToken:false}});
  const duplicate=w.call('xiaok/auth/snapshot',{},w.initialized.id).catch(error=>({fixtureError:error.message}));
  const deadline=Date.now()+2500;
  while(!w.pipeEvents.some(event=>event.event==='native-exit')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const reaped=w.pipeEvents.find(event=>event.event==='native-exit');
  const after=await w.pipeControl('status');
  await w.pipeControl('resume');
  const reply=await snapshot,dup=await duplicate;
  const leaked=reply.result?.accessToken===tokens.access_token;
  t.diagnostic(JSON.stringify({case:'ingress-overload-duplicate-partial',prefixBytes:prefix.bufferedBytes,afterBytes:after.bufferedBytes,exitedWhileHeld:!!reaped,duplicateError:dup.error?.message,leaked}));
  assert.equal(reply.fixtureError,undefined,'timeout does not qualify final-write denial');
  assert.equal(dup.fixtureError,undefined,'duplicate timeout does not prove it passed the original registry');
  assert.equal(leaked,false,'the original overload shortcut must not discard duplicate and resume an old genuine secret delivery');
  assert.ok(reaped?.reaped,'partial revocation must physically exit while reader is held');
  assert.equal(reaped.signal,0);
  assert.equal(after.bufferedBytes,prefix.bufferedBytes,'no error, newline or remaining secret bytes after partial duplicate');
  const exit=await w.endAndDrain();assert.equal(exit.signal,null);
});

test('ingress overload must not replace the zero-offset duplicate error nor revive a queued genuine delivery',{skip,timeout:30000},async t=>{
  const oauth=await syntheticIssuer(t),w=await oauthWorker(t,oauth,{physicalStdoutPipe:true});
  await completeBrowser(w,await beginBrowser(w));
  const physical=await holdFullPublicPipe(w),snapshotId='zero-byte-snapshot-before-overload';
  w.send({id:snapshotId,method:'xiaok/auth/snapshot',params:{}});
  // This later exclusive account-auth operation reaches actual synthetic HTTP
  // only after the preceding original snapshot sender has completed enqueue.
  const prior=oauth.requests.filter(r=>r.path==='/oauth/token').length;
  w.send({id:'same-original-account-queue-barrier',method:'xiaok/auth/snapshot',params:{refresh:true}});
  await eventually(()=>oauth.requests.filter(r=>r.path==='/oauth/token').length>prior,'the original later refresh must actually reach HTTP after snapshot enqueue');
  // A bounded burst with no auth mutation. Total pending input lines stay
  // inside the fixed raw budget, so the only legal answer for the reused
  // initialize ID is the original registry's fixed duplicate error.
  for(let i=0;i<200;i++)w.send({id:`zero-offset-overload-${i}`,method:'account/read',params:{refreshToken:false}});
  const duplicate=w.call('xiaok/auth/snapshot',{},w.initialized.id);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(w.isAlive(),true,'the bounded raw budget must keep the original native alive under ingress overload');
  await w.pipeControl('resume');
  const rejected=await duplicate;
  assert.notEqual(rejected.error?.message,'Server overloaded; retry later.','a lower-side overload reply must never substitute the registry');
  assert.equal(rejected.error?.message,'xiaok_auth_request_id_rejected');
  assert.equal(w.transcript.some(frame=>frame.id===snapshotId),false,'the zero-byte old delivery must stay dropped even under ingress overload');
  await assert.rejects(w.call('account/read',{refreshToken:false},'probe-after-overloaded-duplicate',200),/native_response_timeout/);
  assert.equal(w.isAlive(),true);
  const exit=await w.endAndDrain();assert.deepEqual(exit,{code:0,signal:null});
  assert.equal(w.transcript.some(frame=>frame.id===snapshotId),false);
  assert.equal(w.transcript.some(frame=>frame.id==='probe-after-overloaded-duplicate'),false);
  assert.ok(w.pipeEvents.some(event=>event.event==='native-exit'&&event.reaped&&event.signal===0));
  t.diagnostic(JSON.stringify({case:'zero-offset-ingress-overload-duplicate',...physical,duplicateFixedError:true,overloadReplyReplaced:false,oldDeliveryAbsent:true,aliveUnderBoundedOverload:true,actualEofExit0:true}));
});
