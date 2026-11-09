'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const [addon,domain,result,userData,mode='api']=process.argv.slice(2);
const app=require('electron').app;
app.setPath('userData',userData);
app.disableHardwareAcceleration();
let native,issuer;
async function run(){
 await app.whenReady();
 native=require(addon);
 issuer=native.openOriginalMainIssuer();
 assert.equal(native.buildInfo().nativeQualified,false);
 if(mode==='finish'){
  assert.equal(typeof native.finishOriginalRoot,'function');
  native.installFresh(issuer);const key=native.takeOriginalRoomDiscussionSourceKey(issuer);
  for(let i=0;i<6;i++)native.enqueue(issuer,native.importOriginalRoomTurnSubject(key,'profile','workspace','principal','durable-host','room','message-'+i,'agent','turn-'+i,'{"task":"original"}','authorization'));
  const permits=[];for(let i=0;i<5;i++)permits.push(native.claimNext(issuer).reservation);
  assert.equal(native.claimNext(issuer),null);
  assert.throws(()=>native.finishOriginalRoot(issuer,permits[0]),/NOT_CONSUMED/);
  for(const permit of permits)native.consumeLaunch(issuer,permit);
  assert.equal(native.finishOriginalRoot(issuer,permits[0]).newlyFinished,true);
  assert.equal(native.finishOriginalRoot(issuer,permits[0]).newlyFinished,false);
  assert.equal(native.readRecord(issuer,native.finishOriginalRoot(issuer,permits[0]).record.executionKey).state,'released');
  assert.ok(native.claimNext(issuer).reservation);
  let traps=0;const copy=new Proxy({},{get(){traps++;throw Error('trap');}});
  assert.throws(()=>native.finishOriginalRoot(issuer,copy),/RESERVATION_REQUIRED/);assert.equal(traps,0);
  native.revokeOriginalMainIssuer(issuer);
  assert.equal(native.finishOriginalRoot(issuer,permits[1]).newlyFinished,true);
  return{exactConsumedNativeMember:true,capacityReused:true,afterRevokeNegative:true,notHostPhysicalQualification:true};
 }
 if(mode.startsWith('business')){
  for(const name of ['importOriginalKSwarmTaskSubject','importOriginalRoomProjectSubject','importOriginalWorkflowRootSubject'])assert.equal(typeof native[name],'function',name);
  if(mode==='business-api')return{fixedBusinessApi:true,notBusinessSourceQualification:true};
  native.installFresh(issuer);
  const base=['profile','workspace','principal','durable-host'];
  const cases=[
   ['takeOriginalKSwarmDirectSourceKey','importOriginalKSwarmTaskSubject',['project','task','run'],'kswarm_direct'],
   ['takeOriginalRoomProjectSourceKey','importOriginalRoomProjectSubject',['room','project','task','run','claim'],'room_project'],
   ['takeOriginalWorkflowRootSourceKey','importOriginalWorkflowRootSubject',['workflow','root-job','run','a'.repeat(64)],'workflow_root'],
  ];
  const wrong=native.takeOriginalRoomDiscussionSourceKey(issuer);
  for(const [take,create,ids,kind] of cases){
   const key=native[take](issuer),args=[...base,...ids,'{"original":"payload"}','original-ref'];
   const subject=native[create](key,...args),result=native.enqueue(issuer,subject),data=JSON.parse(result.record.metadataJson);
   assert.equal(data.executionClass,kind);assert.equal(data.hostId,'durable-host');
   assert.equal(native.enqueue(issuer,native[create](key,...args)).record.executionKey,result.record.executionKey);
   assert.throws(()=>native[create](wrong,...args),/SOURCE_KEY/);
   let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');}});
   assert.throws(()=>native[create](proxy,...args),/SOURCE_KEY/);assert.equal(traps,0);
   assert.equal(native.cancelQueued(issuer,subject).record.state,'cancelled_before_launch');
  }
  return{threeFixedFamilies:true,sameNPool:true,notBusinessSourceQualification:true};
 }
 if(mode.startsWith('physical')){
  for(const name of ['takeOriginalMainTurnSourceKey','importOriginalPhysicalContext','enqueueOriginalModel','claimOriginalModel','settleOriginalModel','enqueueOriginalProcess','claimOriginalProcess','settleOriginalProcess'])assert.equal(typeof native[name],'function',name);
  if(mode==='physical-api')return{physicalApi:true,notSdkFateQualification:true};
  assert.equal(native.installFresh(issuer).installed,true);
  const key=native.takeOriginalMainTurnSourceKey(issuer);
  const context=native.importOriginalPhysicalContext(key,null,'profile','workspace','principal','durable-host','actual-host-task');
  for(let i=0;i<5;i++)native.enqueueOriginalModel(context,'attempt-'+i,'a'.repeat(64));
  for(let i=0;i<3;i++)native.enqueueOriginalProcess(context,'worker-'+i,'b'.repeat(64));
  const models=[],processes=[];
  for(let i=0;i<4;i++){const value=native.claimOriginalModel(issuer);assert.ok(value.permit);models.push(value.permit);}
  assert.equal(native.claimOriginalModel(issuer),null);
  for(let i=0;i<2;i++){const value=native.claimOriginalProcess(issuer);assert.ok(value.permit);processes.push(value.permit);}
  assert.equal(native.claimOriginalProcess(issuer),null);
  assert.equal(native.readPolicy(issuer).claimSeq,0,'M/P never increments N');
  assert.equal(native.settleOriginalModel(issuer,models[0]).newlySettled,true);
  assert.equal(native.settleOriginalModel(issuer,models[0]).newlySettled,false);
  assert.ok(native.claimOriginalModel(issuer).permit);
  assert.equal(native.claimOriginalModel(issuer),null);
  assert.throws(()=>native.settleOriginalProcess(issuer,models[1]),/PHYSICAL_PERMIT/);
  return{M:4,P:2,separateFromN:true,settledOnce:true,notSdkFateQualification:true};
 }
 if(mode.startsWith('dsh')){
  assert.equal(typeof native.takeOriginalDshDraftSourceKey,'function');
  assert.equal(typeof native.importOriginalDshDraftSubject,'function');
  const key=native.takeOriginalDshDraftSourceKey(issuer);
  if(mode==='dsh-api')return{dshApiAvailable:true,notBusinessSourceQualification:true};
  assert.equal(native.installFresh(issuer).installed,true);
  const fields=['profile','workspace','principal','durable-host','owner-work','draft-invocation','actual-commit-key','{"body":"actual candidate"}','original-authorization'];
  const subject=native.importOriginalDshDraftSubject(key,...fields);
  const queued=native.enqueue(issuer,subject),data=JSON.parse(queued.record.metadataJson);
  assert.equal(data.schemaVersion,2);assert.equal(data.subject.draftCommitKey,'actual-commit-key');
  assert.equal(data.executionClass,'dsh_draft');assert.equal(data.subject.ownerWorkId,'owner-work');
  assert.equal(native.enqueue(issuer,native.importOriginalDshDraftSubject(key,...fields)).record.executionKey,queued.record.executionKey);
  const wrong=native.takeOriginalRoomDiscussionSourceKey(issuer);
  assert.throws(()=>native.importOriginalDshDraftSubject(wrong,...fields),/SOURCE_KEY/);
  const missing=fields.slice();missing[6]='';assert.throws(()=>native.importOriginalDshDraftSubject(key,...missing),/SUBJECT_DATA/);
  let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
  assert.throws(()=>native.importOriginalDshDraftSubject(proxy,...fields),/SOURCE_KEY/);assert.equal(traps,0);
  native.revokeOriginalMainIssuer(issuer);
  assert.throws(()=>native.importOriginalDshDraftSubject(key,...fields),/REVOKED/);
  assert.equal(native.cancelQueued(issuer,subject).record.state,'cancelled_before_launch');
  return{dshSubjectV2:true,mandatoryCommit:true,traps,acceptedQueuedNegativeAfterRevoke:true,notBusinessSourceQualification:true};
 }
 const key=native.takeOriginalRoomDiscussionSourceKey(issuer);
 assert.equal(typeof native.importOriginalRoomTurnSubject,'function');
 if(mode==='api')return {apiAvailable:true,notBusinessSourceQualification:true};
 assert.equal(native.installFresh(issuer).installed,true);
 const fields=['profile','workspace','principal','durable-host','room','message','agent','room-turn-v1:stable','{"content":"actual candidate bytes"}','original-accepted-reference'];
 const subject=native.importOriginalRoomTurnSubject(key,...fields);
 assert.equal(Object.isFrozen(subject),true);
 assert.deepEqual(Reflect.ownKeys(subject),[]);
 const queued=native.enqueue(issuer,subject),metadata=JSON.parse(queued.record.metadataJson);
 assert.equal(metadata.schemaVersion,2);
 assert.equal(metadata.subject.messageId,'message');
 assert.equal(metadata.hostId,'durable-host');
 assert.equal(metadata.priorityClass,'background');
 assert.equal(metadata.payloadHash,crypto.createHash('sha256').update(fields[8]).digest('hex'));
 assert.equal(native.enqueue(issuer,subject).disposition,'existing_queued');
 const repeated=native.importOriginalRoomTurnSubject(key,...fields);
 assert.equal(native.enqueue(issuer,repeated).record.executionKey,queued.record.executionKey);
 let traps=0;
 const proxy=new Proxy({},{get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
 for(const fake of [{...key},proxy,null,Promise.resolve()])assert.throws(()=>native.importOriginalRoomTurnSubject(fake,...fields),/SOURCE_KEY/);
 const project=native.takeOriginalRoomProjectSourceKey(issuer);
 assert.throws(()=>native.importOriginalRoomTurnSubject(project,...fields),/SOURCE_KEY/);
 for(const value of ['\ud800','\udc00','bad\0identity',proxy,new String('boxed')]){
  const bad=fields.slice();bad[5]=value;
  assert.throws(()=>native.importOriginalRoomTurnSubject(key,...bad),/SUBJECT_DATA|ARGUMENT/);
 }
 assert.equal(traps,0);
 const unicode=fields.slice();unicode[5]='\ufffd';
 assert.notEqual(native.enqueue(issuer,native.importOriginalRoomTurnSubject(key,...unicode)).record.executionKey,queued.record.executionKey);
 const changed=fields.slice();changed[8]='{"content":"different candidate"}';
 assert.throws(()=>native.enqueue(issuer,native.importOriginalRoomTurnSubject(key,...changed)),/INPUT_CONFLICT/);
 assert.equal(native.readPolicy(issuer).enqueueSeq,2);
 const reserved=native.claimNext(issuer);
 assert.ok(reserved.reservation);
 assert.equal(reserved.record.executionKey,queued.record.executionKey);
 assert.equal(native.consumeLaunch(issuer,reserved.reservation).newlyConsumed,true);
 assert.equal(native.consumeLaunch(issuer,reserved.reservation).newlyConsumed,false);
 native.revokeOriginalMainIssuer(issuer);
 assert.throws(()=>native.importOriginalRoomTurnSubject(key,...fields),/REVOKED/);
 return {notBusinessSourceQualification:true,subjectOpaque:true,stableIdentity:true,traps,queued:2,consumedOnce:true};
}
run().then(facts=>{
 if(issuer)native.close(issuer);
 fs.writeFileSync(result+'.tmp',JSON.stringify({pid:process.pid,ok:true,...facts}),{flag:'wx',mode:0o600});
 fs.renameSync(result+'.tmp',result);
},error=>{
 try{if(issuer)native.close(issuer);}catch{}
 fs.writeFileSync(result,JSON.stringify({pid:process.pid,ok:false,error:error.stack}));
 process.stderr.write(error.stack+'\n');process.exitCode=1;
}).finally(()=>app.quit());
