import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,hkdfSync} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('fixed Broker domain4 wire/KDF separates original domains and preserves reserved opcode27',{skip:process.platform!=='darwin'},()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-wire-domain-'));
 const paths=['native/main-installation/protocol.h','native/main-installation/wire.h','native/main-installation/wire.c','tests/native/fixtures/broker-wire-domain.c'];
 const digest=path=>createHash('sha256').update(readFileSync(join(repo,path))).digest('hex');
 const before=paths.map(digest);
 function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:30000});console.log(JSON.stringify({ownedWireProcess:{pid:r.pid,status:r.status,signal:r.signal,command}}));assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
 try{
  const exe=join(root,'wire');run('/usr/bin/cc',['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-DMI_FIXTURE_BUILD=1','-I',join(repo,'native/main-installation'),join(repo,'tests/native/fixtures/broker-wire-domain.c'),join(repo,'native/main-installation/wire.c'),'-framework','Security','-lbsm','-o',exe]);
  const actual=JSON.parse(run(exe,[]));assert.equal(actual.domain4Available,true);assert.equal(actual.frameAndNegativeChecks,true);
  const seed=Buffer.from(Array.from({length:32},(_,i)=>i+32)),nonce=Buffer.from(Array.from({length:32},(_,i)=>i)),ids=Buffer.alloc(12);ids.writeUInt32BE(7,0);ids.writeUInt32BE(11,4);ids.writeUInt32BE(502,8);
  const pre=[],final=[];for(let domain=1;domain<=4;domain++){
   const key=Buffer.from(hkdfSync('sha256',seed,nonce,Buffer.concat([Buffer.from('xiaok-main-installation-v1'),Buffer.from([1,domain]),ids]),32));pre.push(key.toString('hex'));
   final.push(Buffer.from(hkdfSync('sha256',key,Buffer.concat([Buffer.alloc(32,0x33),Buffer.alloc(32,0x44)]),Buffer.concat([Buffer.from('xiaok-main-installation-final-v1'),Buffer.from([1,domain]),ids,nonce,Buffer.alloc(32,0x55)]),32)).toString('hex'));
  }
  assert.deepEqual(actual.pre,pre);assert.deepEqual(actual.final,final);assert.equal(new Set(pre).size,4);assert.equal(new Set(final).size,4);assert.deepEqual(paths.map(digest),before);console.log(JSON.stringify({scopeHashes:Object.fromEntries(paths.map((p,i)=>[p,before[i]])),actual}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
