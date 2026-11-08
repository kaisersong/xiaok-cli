import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,lstatSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareRootNmpLedgerFixture} from './helpers/root-nmp-ledger-fixture.mjs';
const require=createRequire(import.meta.url),mac={skip:process.platform!=='darwin',timeout:30000};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function setup(){const p=prepareRootNmpLedgerFixture();process.env.XIAOK_CONFIG_DIR=join(p.root,'config');return {p,writer:require(p.binary),source:require(join(p.root,'native/darwin-universal/root_resource_ledger_source.node'))};}
function originalOpen(p,expected){
 const script=`const api=require(process.argv[1]);try{const s=api.openOriginal();api.close(s);console.log('opened');process.exitCode=0;}catch(raw){console.log(raw.message);process.exitCode=23;}`;
 const child=spawnSync(process.execPath,['-e',script,p.binary],{encoding:'utf8',timeout:5000,env:{...process.env,XIAOK_CONFIG_DIR:join(p.root,'config')}});
 writeFileSync(join(p.root,'writer-'+expected+'.json'),JSON.stringify({pid:child.pid,status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr},null,2));
 assert.equal(child.status,expected,child.stdout+child.stderr);assert.equal(child.signal,null);return child.stdout;
}
test('holds the original existing RootNMP issuer and complete ledger until actual negative release',mac,()=>{
 const {p,writer,source}=setup();assert.equal(typeof source.holdExistingOriginalRootPoolLedger,'function','actual original Source API');
 const s=writer.openOriginal();writer.installFresh(s);
 for(let i=0;i<7;i++){writer.enqueue(s,writer.fixtureSubject(s,i));if(i<5){const c=writer.claimNext(s);writer.consumeLaunch(s,c.reservation);}}
 const before=writer.readOriginalRootPoolLedger(s);writer.close(s);
 const file=join(p.domain,'root-resource-v1.sqlite'),bytes=hash(file),inode=lstatSync(file).ino;
 const held=source.holdExistingOriginalRootPoolLedger();let closed=false;
 try{
  const first=held.read();assert.equal(first.canonicalJson,before.canonicalJson.replace('live-session','existing-ordinary-readonly'));assert.match(first.sha256,/^[a-f0-9]{64}$/);
  assert.match(originalOpen(p,23),/ROOT_RESOURCE_ISSUER_BUSY/);held.check();
  assert.equal(hash(file),bytes);assert.equal(lstatSync(file).ino,inode);
  held.close();closed=true;held.close();assert.throws(()=>held.read(),/CLOSED/);assert.equal(originalOpen(p,0).trim(),'opened');
  assert.equal(hash(file),bytes);assert.equal(lstatSync(file).ino,inode);
  console.log(JSON.stringify({kind:'original-root-nmp-hold',root:p.root,heldWriterBusy:true,releasedWriterOpened:true,ledgerUnchanged:true,inode,dbSha256:bytes,noParentQualification:true,gui:0}));
 }finally{if(!closed)held.close();}
});
test('uses exact original holder receivers without Proxy traps and keeps old capture return-before-release semantics',mac,()=>{
 const {p,writer,source}=setup(),s=writer.openOriginal();writer.installFresh(s);writer.close(s);
 source.captureExistingOriginalRootPoolLedger();assert.equal(originalOpen(p,0).trim(),'opened');
 const h=source.holdExistingOriginalRootPoolLedger();let hits=0;const proxy=new Proxy(h,{get(){hits++;throw 0;},ownKeys(){hits++;throw 0;},getPrototypeOf(){hits++;throw 0;}});
 try{for(const member of ['read','check','close'])for(const receiver of [proxy,{},Object.create(h),{...h},null])assert.throws(()=>Reflect.apply(h[member],receiver,[]),/HOLD_REQUIRED/);assert.equal(hits,0);assert.throws(()=>h.read(undefined),/ARGUMENT/);assert.match(h.read().sha256,/^[a-f0-9]{64}$/);}finally{h.close();}
 const second=source.holdExistingOriginalRootPoolLedger();source.closeOriginalRootPoolLedgerSource();assert.throws(()=>second.read(),/CLOSED/);second.close();
});
test('keeps an observed replacement sticky after restoration while negative close remains reachable',mac,()=>{
 const {p,writer,source}=setup(),s=writer.openOriginal();writer.installFresh(s);writer.close(s);
 const h=source.holdExistingOriginalRootPoolLedger(),file=join(p.domain,'root-resource-v1.sqlite'),saved=file+'.retained';
 renameSync(file,saved);assert.throws(()=>h.check(),/STALE|UNCONFIRMED/);renameSync(saved,file);assert.throws(()=>h.read(),/STALE|UNCONFIRMED/);
 assert.throws(()=>h.close(),/STALE|UNCONFIRMED/);assert.throws(()=>source.holdExistingOriginalRootPoolLedger(),/SOURCE_HELD/);
});
test('retains an actual failed descriptor close instead of publishing a known terminal holder',mac,()=>{
 const {writer,source}=setup(),s=writer.openOriginal();writer.installFresh(s);writer.close(s);const h=source.holdExistingOriginalRootPoolLedger();
 h.fixtureBreakProbe();assert.throws(()=>h.close(),/CLOSE_UNCONFIRMED/);assert.throws(()=>h.close(),/CLOSE_UNCONFIRMED/);assert.throws(()=>source.closeOriginalRootPoolLedgerSource(),/CLOSE_UNCONFIRMED/);assert.throws(()=>source.holdExistingOriginalRootPoolLedger(),/SOURCE_HELD/);
});
test('missing sources never create a pool and explicit recovery sidecars are not consumed',mac,()=>{
 const {p,writer,source}=setup();assert.deepEqual(readdirSync(p.domain),[]);assert.throws(()=>source.holdExistingOriginalRootPoolLedger(),/SOURCE_MISSING/);assert.deepEqual(readdirSync(p.domain),[]);
 const s=writer.openOriginal();writer.installFresh(s);writer.close(s);const file=join(p.domain,'root-resource-v1.sqlite'),side=file+'-journal';writeFileSync(side,'original recovery bytes');const before=readFileSync(side),inode=lstatSync(side).ino;
 assert.throws(()=>source.holdExistingOriginalRootPoolLedger(),/RECOVERY_REQUIRED/);assert.deepEqual(readFileSync(side),before);assert.equal(lstatSync(side).ino,inode);
});
