import test from 'node:test';import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';import {createRequire} from 'node:module';import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('actual Node Worker native Environment thread identity ignores copied workerData and public module threadId', {skip:process.platform!=='darwin'},async()=>{
 const root=mkdtempSync(join(tmpdir(),'budget-env-'));mkdirSync(join(root,'config'),{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const headers=process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node');const addon=join(root,'env.node');
 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const args=['-std=c++20','-Werror','-bundle','-undefined','dynamic_lookup','-isysroot',sdk.stdout.trim(),'-I',headers,...(process.config.variables.v8_enable_pointer_compression?['-DV8_COMPRESS_POINTERS']:[]),...(process.config.variables.v8_enable_sandbox?['-DV8_ENABLE_SANDBOX']:[]),join(repo,'tests/native/fixtures/budget-worker-environment-probe.cc'),'-o',addon];
 const built=spawnSync('/usr/bin/c++',args,{encoding:'utf8'});writeFileSync(join(root,'build.json'),JSON.stringify({args,pid:built.pid,code:built.status,signal:built.signal,stderr:built.stderr}));assert.equal(built.status,0,built.stderr);
 const native=createRequire(import.meta.url)(addon);const parent=native.inspectOriginalWorkerEnvironment();assert.equal(parent.nativeIsMainThread,true);assert.equal(parent.nativeThreadId,0);assert.equal(parent.hasOriginalEnvironment,true);
 const getId=Object.getOwnPropertyDescriptor(Worker.prototype,'threadId').get;
 const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const wt=require('node:worker_threads');wt.threadId=999999;const api=require(workerData.addon);parentPort.postMessage({native:api.inspectOriginalWorkerEnvironment(),copiedId:workerData.threadId,publicId:wt.threadId});`,{eval:true,workerData:{addon,threadId:999999},execArgv:[]});
 const actualId=Reflect.apply(getId,worker,[]);let exitCode;const exited=new Promise((yes,no)=>{worker.once('error',no);worker.once('exit',code=>{exitCode=code;yes();});});
 const result=await new Promise((yes,no)=>{worker.once('message',yes);worker.once('error',no);});await exited;
 assert.equal(exitCode,0);assert.equal(result.native.nativeThreadId,actualId);assert.equal(result.native.nativeIsMainThread,false);assert.equal(result.native.hasOriginalEnvironment,true);assert.notEqual(result.native.nativeThreadId,result.copiedId);assert.equal(result.publicId,999999);assert.equal(result.native.productionQualified,false);
 const facts={kind:'native-budget-worker-env-observation',root,parent,actualId,result,exitCode,gui:0,remainingWorkers:0,notAuthorityProof:true};writeFileSync(join(root,'facts.json'),JSON.stringify(facts,null,2));console.log(JSON.stringify(facts));
});
