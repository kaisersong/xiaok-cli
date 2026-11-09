import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire,Module} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
// Execute the exact fixed file-reader source with one SDK failure. Real fs
// functions/real FD are delegated; this is a negative ordinary fixture, never
// genuine Native/Main qualification or a replacement of a private Native port.
const fileModule=fileURLToPath(new URL('../../desktop/electron/broker-runtime-file.cjs',import.meta.url));
const source=fs.readFileSync(fileModule,'utf8');
const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'broker-sdk-tail-')));
const dir=join(root,'services','intent-broker','runtime','darwin-arm64');fs.mkdirSync(dir,{recursive:true});
const manifest=join(dir,'manifest.json');fs.writeFileSync(manifest,'{}');
let release;const held=new Promise(done=>{release=done;});
const first=Error('actual-package-close-failure');Object.defineProperty(first,Symbol('owned-sdk-tail'),{value:held});
let ownedFd,opens=0;
const facade={...fs,openSync(path,...args){const fd=fs.openSync(path,...args);if(resolve(path)===manifest){ownedFd??=fd;opens++;}return fd;},closeSync(fd){if(fd===ownedFd)throw first;return fs.closeSync(fd);}};
const module={exports:{}};
vm.runInNewContext(source,{module,exports:module.exports,Buffer,require:name=>name==='node:fs'?facade:require(name)},{filename:fileModule});
assert.equal(require.cache[fileModule],undefined);
const actual=new Module(fileModule);actual.filename=fileModule;actual.loaded=true;actual.exports=module.exports;require.cache[fileModule]=actual;
const api=await import('../../desktop/electron/broker-node-runtime.ts');
test('fixed negative Main reader waits original own-symbol tail and never clears unknown actual FD',{timeout:5000},async t=>{
 t.after(()=>{release();if(ownedFd!==undefined){fs.closeSync(ownedFd);ownedFd=undefined;}fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 let caught=false;try{api.resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:root,platform:'darwin',arch:'arm64',env:{}});}catch(raw){caught=true;assert.equal(raw,first);}assert.equal(caught,true);
 const initialOpens=opens;assert.ok(initialOpens>=1);assert.equal(fs.fstatSync(ownedFd).isFile(),true);
 let settled=false;const waiting=api.waitBrokerRuntimeReadsKnown().then(()=>{settled=true;return null;},raw=>{settled=true;return raw;});
 await new Promise(done=>setImmediate(done));assert.equal(settled,false,'SDK held tail must join before close fate can settle');
 release();const failure=await waiting;assert.ok(failure);assert.match(failure.message,/broker_runtime_read_custody_unconfirmed/);
 assert.throws(()=>api.assertBrokerRuntimeReadsKnown(),/custody_unknown/);
 assert.throws(()=>api.resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:root,platform:'darwin',arch:'arm64',env:{}}),/custody_unknown/);assert.equal(opens,initialOpens);
 fs.closeSync(ownedFd);ownedFd=undefined;assert.throws(()=>api.assertBrokerRuntimeReadsKnown(),/custody_unknown/,'external cleanup is not caller permission to mark the original row known');
});
