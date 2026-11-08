import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('original Broker Native child preparation rejects foreign Core before any spawn',{skip:process.platform!=='darwin'},()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-native-foreign-'));mkdirSync(join(root,'config'),{mode:0o700});
 const paths=['native/root-resource-authority/installed-main-client.c','native/root-resource-authority/installed-main-client.h','native/root-resource-authority/installed-main-core-private.h','native/root-resource-authority/installed-main-store-association-private.h','native/root-resource-authority/installed-main-store-files-private.h','native/main-installation/protocol.h','native/main-installation/wire.c','tests/native/fixtures/broker-authority-foreign.c'];
 const hashes=()=>Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(join(repo,p))).digest('hex')]));const before=hashes();
 const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:30000,...options});console.log(JSON.stringify({brokerNativeProcess:{pid:r.pid,status:r.status,signal:r.signal,command}}));assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
 try{
  const bin=join(root,'foreign');run('/usr/bin/cc',['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',join(repo,'native/root-resource-authority'),'-I',join(repo,'native/main-installation'),join(repo,'tests/native/fixtures/broker-authority-foreign.c'),join(repo,'native/root-resource-authority/installed-main-client.c'),join(repo,'native/main-installation/wire.c'),'-lsqlite3','-framework','Security','-framework','CoreFoundation','-lbsm','-o',bin]);
  assert.deepEqual(JSON.parse(run(bin,[],{env:{...process.env,XIAOK_CONFIG_DIR:join(root,'config')}})),{foreignCoreRejected:true,childSpawns:0,productionQualified:false});assert.deepEqual(hashes(),before);console.log(JSON.stringify({scopeHashes:before}));
 }finally{rmSync(root,{recursive:true,force:true});}
});

import {runOriginalBrokerComponent} from './helpers/broker-authority-fixture.mjs';
test('original Broker Core preparation is once, holds Root close and permits negative unlaunched cancel',{skip:process.platform!=='darwin'},async()=>{
 const rows=await runOriginalBrokerComponent(false);const facts=rows.find(x=>x.kind==='broker-fixed-native-core-component');assert.ok(facts);assert.deepEqual(facts,{kind:'broker-fixed-native-core-component',failure:0,onceZeroIo:true,coreCloseHeld:true,negativeCleanupKnown:true,rootFilesClosed:true,unknown:false,productionQualified:false});assert.equal(rows.filter(x=>x.event==='spawn').length,1);assert.equal(rows.filter(x=>x.event==='reaped').length,1);
});
test('original Broker delegates only its family to an independent child with real VFS and fd3',{skip:process.platform!=='darwin'},async()=>{
 const rows=await runOriginalBrokerComponent(true);const delegated=rows.find(x=>x.kind==='broker-fixed-delegated-child');assert.ok(delegated);assert.equal(delegated.failure,0);assert.equal(delegated.businessFd3,true);assert.equal(delegated.rootDeniedZeroIo,true);assert.equal(delegated.productionQualified,false);const facts=rows.find(x=>x.kind==='broker-fixed-native-core-component');assert.ok(facts);assert.equal(facts.failure,0);assert.equal(facts.rootFilesClosed,true);assert.equal(facts.unknown,false);assert.equal(rows.filter(x=>x.event==='spawn').length,1);assert.equal(rows.filter(x=>x.event==='reaped').length,1);
});
test('child exit zero without original namespace close cannot retire the family or release Root',{skip:process.platform!=='darwin'},async()=>{
 const rows=await runOriginalBrokerComponent(true,true);const child=rows.find(x=>x.kind==='broker-skipped-original-close');assert.ok(child);assert.equal(child.exitStatus,0);const rejected=rows.find(x=>x.kind==='broker-missing-close-rejected');assert.ok(rejected);assert.equal(rejected.childPid,child.pid);assert.equal(rejected.childExitStatus,0);assert.equal(rejected.waitRejected,true);assert.equal(rejected.physicalKnown,false);assert.equal(rejected.terminalRejected,true);assert.equal(rejected.rootCloseHeld,true);assert.equal(rejected.productionQualified,false);assert.equal(rows.find(x=>x.event==='reaped').unknown,true);
});
