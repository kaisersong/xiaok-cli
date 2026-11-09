// Test-only account dependency leases. Callers release only after every actual
// account callback has settled; an accepted dispose rejection is not that proof.
import {closeSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,rmSync,unlinkSync,writeFileSync,fsyncSync} from 'node:fs';
import {threadId} from 'node:worker_threads';
import {randomBytes,createHash} from 'node:crypto';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const nonce=()=>randomBytes(16).toString('hex');
const token=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const workerKey=()=>process.pid+'-'+threadId;
const fail=()=>{throw Error('test_profile_account_ownership_unknown');};
function identity(path,directory){
 const stat=lstatSync(path);
 if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||(!directory&&stat.nlink!==1)||realpathSync(path)!==path||(process.platform!=='win32'&&(stat.mode&0o077)!==0))fail();
 return {uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs};
}
const same=(actual,expected)=>['uid','dev','ino','birthtimeMs'].every(key=>Number.isFinite(expected?.[key])&&actual[key]===expected[key]);
function exact(path,expected,directory){if(!same(identity(path,directory),expected))fail();}
function syncWrite(path,bytes,flag){
 const fd=openSync(path,flag,0o600);let failure;
 try{writeFileSync(fd,bytes);fsyncSync(fd);}catch(error){failure={error};}
 try{closeSync(fd);}catch(error){if(failure)throw new AggregateError([failure.error,error],'test_profile_account_write_and_close_failed',{cause:failure.error});throw error;}
 if(failure)throw failure.error;
}
function rootFacts(record){
 if(!record||record.version!==1||!token(record.runNonce)||typeof record.root!=='string'||!isAbsolute(record.root))fail();
 exact(record.root,record.rootIdentity,true);
 const leases=join(record.root,'.owner-leases'),records=join(record.root,'.owner-records'),meta=join(record.root,'.owner-identity.json');
 exact(leases,record.leasesIdentity,true);exact(records,record.recordsIdentity,true);exact(meta,record.metaIdentity,false);
 if(hash(readFileSync(meta))!==record.metaSha256)fail();
 return {leases,records,meta};
}
function readState(record,onlyWorker){
 const facts=rootFacts(record),active=new Map(),names=readdirSync(facts.records),ids=new Set();
 for(const name of names){
  if(!/^[1-9][0-9]*-[0-9]+\.[a-f0-9]{32}\.(json|released)$/.test(name))fail();
  if(!onlyWorker||name.startsWith(onlyWorker+'.'))ids.add(name.split('.').slice(0,2).join('.'));
 }
 for(const id of ids){
  const file=join(facts.records,id+'.json');identity(file,false);
  const bytes=readFileSync(file),row=JSON.parse(bytes);
  if(row.version!==1||row.runNonce!==record.runNonce||row.key!==id||row.workerKey!==id.split('.')[0]||!token(row.id)||id!==row.workerKey+'.'+row.id||!token(row.caseNonce)||!Number.isSafeInteger(row.pid)||row.pid<=0||typeof row.account!=='string'||dirname(row.account)!==record.root||!/^account-/.test(basename(row.account))||typeof row.markerSha256!=='string')fail();
  exact(row.account,row.accountIdentity,true);
  const released=id+'.released';
  if(names.includes(released)){
   const ackFile=join(facts.records,released);identity(ackFile,false);
   const ack=JSON.parse(readFileSync(ackFile,'utf8'));
   if(ack.version!==1||ack.runNonce!==record.runNonce||ack.key!==id||ack.workerKey!==row.workerKey||ack.pid!==row.pid||ack.recordSha256!==hash(bytes))fail();
  }else active.set(id,row);
 }
 const allMarkers=readdirSync(facts.leases);
 if(allMarkers.some(name=>!/^[1-9][0-9]*-[0-9]+\.[a-f0-9]{32}\.json$/.test(name)))fail();
 const markers=allMarkers.filter(name=>!onlyWorker||name.startsWith(onlyWorker+'.')).sort(),expected=[...active.keys()].map(id=>id+'.json').sort();
 if(JSON.stringify(markers)!==JSON.stringify(expected))fail();
 for(const row of active.values()){
  const path=join(facts.leases,row.key+'.json');exact(path,row.markerIdentity,false);
  if(hash(readFileSync(path))!==row.markerSha256)fail();
 }
 return {...facts,active};
}

export function createProfileAccountOwnership(root){
 const record={version:1,runNonce:nonce(),root,rootIdentity:identity(root,true)};
 const leases=join(root,'.owner-leases');mkdirSync(leases,{mode:0o700});record.leasesIdentity=identity(leases,true);
 const records=join(root,'.owner-records');mkdirSync(records,{mode:0o700});record.recordsIdentity=identity(records,true);
 const meta=join(root,'.owner-identity.json');syncWrite(meta,JSON.stringify(record)+'\n','wx');record.metaIdentity=identity(meta,false);record.metaSha256=hash(readFileSync(meta));
 rootFacts(record);return record;
}

export function assertProfileAccountWorkerReleased(record){
 const state=readState(record,workerKey());
 if(state.active.size)throw Error('test_profile_account_worker_callbacks_pending');
}

export function acquireProfileAccountLease(record,account,caseNonce){
 if(!token(caseNonce))fail();
 const state=readState(record,workerKey());
 if(typeof account!=='string'||!isAbsolute(account)||dirname(account)!==record.root||relative(record.root,account)!==basename(account)||!/^account-/.test(basename(account)))fail();
 const accountIdentity=identity(account,true),id=nonce(),key=workerKey()+'.'+id,path=join(state.leases,key+'.json');
 const body={version:1,runNonce:record.runNonce,id,key,workerKey:workerKey(),caseNonce,pid:process.pid,ppid:process.ppid,account,accountIdentity};
 syncWrite(path,JSON.stringify(body)+'\n','wx');
 const markerIdentity=identity(path,false),markerSha256=hash(readFileSync(path));
 const recordFile=join(state.records,key+'.json');
 const recordBytes=JSON.stringify({...body,markerIdentity,markerSha256})+'\n';
 syncWrite(recordFile,recordBytes,'wx');
 const recordIdentity=identity(recordFile,false),recordSha256=hash(recordBytes);
 let released=false;
 return Object.freeze({id,path,account,release(){
  if(released)return;
  const current=readState(record,workerKey()),row=current.active.get(key);
  if(!row||row.pid!==process.pid||row.caseNonce!==caseNonce||row.markerSha256!==markerSha256||!same(row.markerIdentity,markerIdentity))fail();
  exact(recordFile,recordIdentity,false);if(hash(readFileSync(recordFile))!==recordSha256)fail();
  unlinkSync(path);
  // Only this lease's immutable acknowledgement changes. Other workers have
  // independent files, so parallel acquisition cannot overwrite their state.
  // A failed acknowledgement leaves a missing active marker and retains root.
  syncWrite(join(current.records,key+'.released'),JSON.stringify({version:1,runNonce:record.runNonce,key,workerKey:workerKey(),pid:process.pid,recordSha256})+'\n','wx');
  readState(record,workerKey());released=true;
 }});
}

export function teardownProfileAccount(record){
 try{
  const state=readState(record);
  if(state.active.size)throw Error('test_profile_account_callbacks_pending');
  rootFacts(record);
  rmSync(record.root,{recursive:true,force:false,maxRetries:10,retryDelay:50});
 }catch(error){
  // Diagnostic failure must never replace the original retention reason.
  try{
   exact(record.root,record.rootIdentity,true);
   syncWrite(join(record.root,'.retained-'+record.runNonce+'-'+process.pid+'-'+nonce()+'.json'),JSON.stringify({version:1,runNonce:record.runNonce,pid:process.pid,reason:'account_ownership_unknown_or_pending'})+'\n','wx');
  }catch(receipt){throw new AggregateError([error,receipt],'test_profile_account_retention_receipt_failed',{cause:error});}
  throw error;
 }
}
