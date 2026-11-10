import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareRootNmpCustodyFixture} from './helpers/root-nmp-custody-fixture.mjs';
const require=createRequire(import.meta.url),mac={skip:process.platform!=='darwin',timeout:30000};
test('the original root-broker Entry owns an actual Native hold through check/read/release',mac,async()=>{
 const p=await prepareRootNmpCustodyFixture();process.env.XIAOK_CONFIG_DIR=join(p.root,'config');
 const api=require(p.binary),source=require(join(p.root,'native/darwin-universal/root_resource_ledger_source.node'));
 const s=api.openOriginal();api.installFresh(s);for(let i=0;i<7;i++){api.enqueue(s,api.fixtureSubject(s,i));if(i<5){const c=api.claimNext(s);api.consumeLaunch(s,c.reservation);}}api.close(s);
 const prior=source.captureExistingOriginalRootPoolLedger(),file=join(p.domain,'root-resource-v1.sqlite'),before=readFileSync(file),directory=lstatSync(p.domain,{bigint:true}),db=lstatSync(file,{bigint:true});
 const uid=process.getuid(),peer={uid,gid:process.getgid(),pid:process.pid,auditSessionId:3},sourceSet={schemaVersion:1,authorityId:'authority',profileId:'profile',uid,accountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryGeneration:'1',sources:[{sourceId:'original-root',namespaceId:'original-account',kind:'sqlite-db',snapshotFormat:'root-nmp-ledger-v1',directory:{canonicalPath:p.domain,device:String(directory.dev),inode:String(directory.ino)},database:{basename:'root-resource-v1.sqlite',device:String(db.dev),inode:String(db.ino)},reviewedSnapshotSha256:prior.sha256}]};
 const {canonicalVerificationJson:encode}=require(p.protocol);
 const review={version:1,purpose:'profile-source-custody',authorityId:'authority',challengeId:'actual-hold',principal:{uid,accountGeneration:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',auditSessionId:2},requestSource:'user',sourceSet,inventoryHash:createHash('sha256').update(encode(sourceSet)).digest('hex'),deadline:{domainId:'continuous',qualificationEpoch:1,notBefore:1,validUntil:1000}};
 const {createProfileSourceCustodyRegistry}=require(p.registry);assert.equal(typeof createProfileSourceCustodyRegistry,'function');
 const registry=createProfileSourceCustodyRegistry({authorityId:'authority',allowedUserIds:[uid],directoryHelper:'/not-called',sqliteHelper:'/not-called',rootNmpHelper:p.executable,clock:()=>({domainId:'continuous',qualificationEpoch:1,evidenceHash:'e'.repeat(64),lowerBound:10,upperBound:11}),observe:async()=> 'actual-component-incarnation',resolveAccount:async()=>review.principal.accountGeneration,approve:async input=>createHash('sha256').update(input.reviewBytes).digest('hex')});
 const records=[];let handle;
 try{
  const receipt=await registry.authorize(review,peer,new AbortController().signal);handle=(await registry.captureRootNmp({challengeId:receipt.challengeId,reviewHash:receipt.reviewHash},peer,new AbortController().signal)).handle;
  const script=`const api=require(process.argv[1]);try{const s=api.openOriginal();api.close(s);console.log('opened');process.exitCode=0;}catch(raw){console.log(raw.message);process.exitCode=23;}`;
  const attempt=()=>{const child=spawnSync(process.execPath,['-e',script,p.binary],{encoding:'utf8',env:{...process.env,XIAOK_CONFIG_DIR:join(p.root,'config')}});records.push({pid:child.pid,status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr});return child;};
  assert.equal(attempt().status,23);await registry.check(handle,peer,new AbortController().signal);
  const bytes=await registry.readRootNmp(handle,0,256,peer,new AbortController().signal);assert.equal(bytes.toString(),JSON.stringify(prior).slice(0,256));
  await registry.release(handle,peer);handle=undefined;assert.equal(attempt().status,0);assert.deepEqual(readFileSync(file),before);assert.equal(lstatSync(file,{bigint:true}).ino,db.ino);
  console.log(JSON.stringify({kind:'original-entry-native-hold',root:p.root,realSqlite:true,actualNativeHold:true,componentOnly:true,productionQualified:false,gui:0,componentBirth:JSON.parse(readFileSync(join(p.root,'component-birth.json'),'utf8')),records}));
 }finally{if(handle)await registry.release(handle,peer);await registry.close();writeFileSync(join(p.root,'entry-child-records.json'),JSON.stringify(records,null,2));}
});

test('actual live issuer BUSY is a known refusal and can be retried after its real owner closes',mac,async()=>{
 const p=await prepareRootNmpCustodyFixture();process.env.XIAOK_CONFIG_DIR=join(p.root,'config');const api=require(p.binary),s=api.openOriginal();api.installFresh(s);
 const {build}=await import('esbuild'),driver=join(p.root,'driver.cjs');await build({entryPoints:[new URL('../../src/runtime/verification/root-nmp-custody-process.ts',import.meta.url).pathname],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:driver,define:{'import.meta.url':'__url'},banner:{js:"const __url=require('node:url').pathToFileURL(__filename).href;"},logLevel:'silent'});
 const {prepareRootNmpCustodyAttempt,startRootNmpCustodyProcess,closeRootNmpCustodyAttempt,readRootNmpCustodyAttemptFate}=require(driver),first=prepareRootNmpCustodyAttempt();
 try{await assert.rejects(startRootNmpCustodyProcess(first,{executable:p.executable,uid:process.getuid(),signal:new AbortController().signal,maximumBytes:128*1024**2}),/ROOT_LEDGER_ISSUER_BUSY/);await closeRootNmpCustodyAttempt(first).catch(()=>{});await readRootNmpCustodyAttemptFate(first).waitPhysicalKnown();readRootNmpCustodyAttemptFate(first).assertPhysicalKnown();}finally{api.close(s);}
 const second=prepareRootNmpCustodyAttempt();
 // The first launch is physically known before archiving its own single-use
 // birth record. The second ordinary launch receives its own recorded birth.
 const {unlinkSync}=await import('node:fs');const birth=JSON.parse(readFileSync(join(p.root,'component-birth.json'),'utf8'));writeFileSync(join(p.root,'refusal-birth.json'),JSON.stringify(birth));unlinkSync(join(p.root,'component-birth.json'));
 const owner=await startRootNmpCustodyProcess(second,{executable:p.executable,uid:process.getuid(),signal:new AbortController().signal,maximumBytes:128*1024**2});await owner.checkCurrent();await closeRootNmpCustodyAttempt(second);readRootNmpCustodyAttemptFate(second).assertPhysicalKnown();
 console.log(JSON.stringify({kind:'actual-busy-known-refusal',root:p.root,firstBirth:birth,secondBirth:JSON.parse(readFileSync(join(p.root,'component-birth.json'),'utf8')),noNewPool:true,componentOnly:true}));
});
