import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../desktop/electron/broker-runtime-file.cjs',import.meta.url),'utf8');
function load(overrides={}) {
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,Buffer,require:name=>name==='node:fs'?{...fs,...overrides}:require(name)}, {filename:'actual-broker-runtime-file.cjs'});
  return module.exports;
}
function file(t) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'broker-read-sdk-'))),path=join(dir,'file');fs.writeFileSync(path,'actual bytes');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3}));return path;
}
function changed(stat,patch){return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,patch);}
test('actual read SDK joins its own handles and hashes exact bytes',t=>{
  const path=file(t),api=load();assert.equal(api.readPackageFile(path,128).bytes.toString(),'actual bytes');api.assertRuntimeFileReadsKnown();
});
test('Windows22 path dev0 obtains independent actual-device probes and preserves BigInt identity',t=>{
  const path=file(t);let opened=0,closed=0;
  const api=load({lstatSync:(p,o)=>changed(fs.lstatSync(p,o),{dev:0n}),openSync(...a){opened++;return fs.openSync(...a);},closeSync(fd){closed++;return fs.closeSync(fd);}});
  assert.equal(api.readPackageFile(path,128).bytes.toString(),'actual bytes');
  assert.equal(opened,3);assert.equal(closed,3);api.assertRuntimeFileReadsKnown();
});
test('independent path probe rejects a different actual device rather than ignoring dev',t=>{
  const path=file(t);let current;
  const api=load({lstatSync:(p,o)=>changed(fs.lstatSync(p,o),{dev:0n}),openSync(...a){const fd=fs.openSync(...a);current??=fd;return fd;},fstatSync(fd,o){const s=fs.fstatSync(fd,o);return fd===current?s:changed(s,{dev:s.dev+1n});}});
  assert.throws(()=>api.readPackageFile(path,128),/broker_runtime_identity/);api.assertRuntimeFileReadsKnown();
});
test('one-bit high BigInt inode change cannot be rounded away',t=>{
  const path=file(t);let stats=0;const high=2n**60n;
  const api=load({lstatSync:(p,o)=>changed(fs.lstatSync(p,o),{ino:high+(stats++?1n:0n)}),fstatSync:(fd,o)=>changed(fs.fstatSync(fd,o),{ino:high})});
  assert.throws(()=>api.readPackageFile(path,128),/broker_runtime_identity/);api.assertRuntimeFileReadsKnown();
});
test('entered open without a returned handle keeps bare undefined and denies new birth',t=>{
  const path=file(t);let calls=0;
  const api=load({openSync(){calls++;throw undefined;}});
  let present=false;try{api.readPackageFile(path,128);}catch(raw){present=true;assert.equal(raw,undefined);}assert.equal(present,true);
  assert.throws(()=>api.assertRuntimeFileReadsKnown(),/custody_unknown/);
  assert.throws(()=>api.readPackageFile(path,128),/custody_unknown/);assert.equal(calls,1);
});
test('read first cause and bare-undefined close second cause remain ordered; no retry marks known',t=>{
  const path=file(t),first=Error('original-read');const tail=Promise.resolve();Object.defineProperty(first,Symbol('sdk-tail'),{value:tail});let fd,closes=0,reads=0;
  const api=load({lstatSync:(p,o)=>changed(fs.lstatSync(p,o),{dev:0n}),openSync(...a){const actual=fs.openSync(...a);fd??=actual;return actual;},readSync(actual){assert.equal(actual,fd);reads++;throw first;},closeSync(actual){if(actual!==fd)return fs.closeSync(actual);closes++;throw undefined;}});
  try{
  try{api.readPackageFile(path,128);assert.fail('must reject');}catch(raw){assert.equal(raw.cause,first);assert.equal(raw.errors[0],first);assert.equal(raw.errors[1],undefined);}
  assert.equal(reads,1);assert.equal(closes,1);assert.throws(()=>api.assertRuntimeFileReadsKnown(),/custody_unknown/);
  assert.throws(()=>api.readPackageFile(path,128),/custody_unknown/);assert.equal(closes,1);
  }finally{if(fd!==undefined)fs.closeSync(fd);} // This fixture owns the faulted data FD; the module stays unknown.
});
test('a replaced/aliased path is rejected with real filesystem state',t=>{
  const path=file(t),alias=path+'-alias';fs.linkSync(path,alias);const api=load();assert.throws(()=>api.readPackageFile(path,128),/broker_runtime_alias/);api.assertRuntimeFileReadsKnown();
});
test('older or unknown actual Darwin release keeps ordinary legacy before any pinned resource IO',()=>{
 const packagePath=new URL('../../desktop/electron/broker-runtime-package.cjs',import.meta.url);
 const text=fs.readFileSync(packagePath,'utf8');const lock=JSON.parse(fs.readFileSync(new URL('../../desktop/resources/broker-runtime-lock.json',import.meta.url),'utf8'));
 for(const release of ['22.5.0','21.6.0','unknown']){
  const module={exports:{}};let reads=0;
  vm.runInNewContext(text,{module,exports:module.exports,process:{platform:'darwin',arch:'arm64',env:{}},require:name=>{
   if(name==='node:os')return {release:()=>release};
   if(name==='../resources/broker-runtime-lock.json')return lock;
   if(name==='./broker-runtime-file.cjs')return {assertRuntimeFileReadsKnown(){},readPackageFile(){reads++;throw Error('must not read unsupported profile');}};
   return require(name);
  }},{filename:'actual-broker-runtime-package.cjs'});
  assert.equal(module.exports.resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:'/unused',env:{}}),null);assert.equal(reads,0);
 }
});
