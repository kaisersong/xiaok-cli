import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Only compilers and nm run here. No app/helper/installed identity is launched.
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const enabled=process.platform==='darwin';
const headers=process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS;
const source=join(repo,'native/root-resource-authority/main-bootstrap.cc');
const sha=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
function compile(name,flags,{nodeHeaders=headers}={}){
 assert.ok(nodeHeaders,'XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS must name the actual Electron 39 headers');
 const root=mkdtempSync(join(tmpdir(),'main-service-macro-')),before=sha();
 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const output=join(root,name+'.o'),args=['-std=c++20','-Werror','-Wno-deprecated-declarations','-DV8_COMPRESS_POINTERS','-DV8_ENABLE_SANDBOX','-isysroot',sdk.stdout.trim(),'-I',nodeHeaders,...flags,'-c',source,'-o',output];
 const result=spawnSync('/usr/bin/c++',args,{encoding:'utf8'});
 writeFileSync(join(root,'compiler.log'),result.stdout+result.stderr);
 writeFileSync(join(root,'run.json'),JSON.stringify({name,source,before,after:sha(),pid:result.pid,reaped:true,status:result.status,signal:result.signal,args,appLaunches:0},null,2));
 console.log(JSON.stringify({name,root,pid:result.pid,status:result.status,signal:result.signal,appLaunches:0}));
 assert.equal(sha(),before);assert.equal(result.error,undefined);assert.equal(result.signal,null);
 return {result,output};
}
function symbols(output){const result=spawnSync('/usr/bin/nm',['-a',output],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
test('release Main compiles without a service component assertion export',{skip:!enabled},()=>{
 const {result,output}=compile('release',[]);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(symbols(output),/AssertServiceComponent/);
});
test('genuine Electron fixture build contains the fixed service component assertion',{skip:!enabled},()=>{
 const {result,output}=compile('fixture',['-DMI_FIXTURE_BUILD=1','-DNR_MAIN_DSH_SERVICE_COMPONENT=1']);assert.equal(result.status,0,result.stderr);assert.match(symbols(output),/AssertServiceComponent/);
});
test('release cannot opt into the service component without the fixture build domain',{skip:!enabled},()=>{
 const {result}=compile('no-fixture',['-DNR_MAIN_DSH_SERVICE_COMPONENT=1']);assert.notEqual(result.status,0);assert.match(result.stderr,/service component requires genuine Electron 39 fixture Main only/);
});
test('pure Node installation component cannot opt into the service component',{skip:!enabled},()=>{
 const {result}=compile('node-component',['-DMI_FIXTURE_BUILD=1','-DNR_MAIN_INSTALLATION_COMPONENT=1','-DNR_MAIN_DSH_SERVICE_COMPONENT=1']);assert.notEqual(result.status,0);assert.match(result.stderr,/service component requires genuine Electron 39 fixture Main only/);
});
test('ordinary Node ABI headers cannot compile the service Main component',{skip:!enabled},()=>{
 const nodeHeaders=process.env.XIAOK_MAIN_COMPONENT_NODE_HEADERS;assert.ok(nodeHeaders,'explicit ordinary Node headers are required for this negative compile');
 const {result}=compile('wrong-abi',['-DMI_FIXTURE_BUILD=1','-DNR_MAIN_DSH_SERVICE_COMPONENT=1'],{nodeHeaders});assert.notEqual(result.status,0);assert.match(result.stderr,/service component requires genuine Electron 39 fixture Main only/);
});
