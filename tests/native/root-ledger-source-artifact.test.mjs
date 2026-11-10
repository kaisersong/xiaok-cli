import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('builds the actual cold-only production Node-API8 artifact deterministically in private outputs',
 {skip:process.platform!=='darwin',timeout:30000},()=>{
 const root=mkdtempSync(join(tmpdir(),'cold-ledger-artifact-')),headers=process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node'),build=join(repo,'scripts/verification/build-root-ledger-source.mjs');
 const outputs=[join(root,'first','root_resource_ledger_source.node'),join(root,'second','root_resource_ledger_source.node')];
 const records=[];
 for(const output of outputs){mkdirSync(dirname(output));const child=spawnSync(process.execPath,[build,'--headers',headers,'--output',output],{cwd:repo,encoding:'utf8',timeout:15000});records.push({pid:child.pid,status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr});writeFileSync(join(root,'builds.json'),JSON.stringify(records,null,2));assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(child.signal,null);}
 assert.deepEqual(readFileSync(outputs[0]),readFileSync(outputs[1]));
 const loadCommands=spawnSync('/usr/bin/otool',['-l',outputs[0]],{encoding:'utf8',timeout:10000});writeFileSync(join(root,'load-commands.txt'),loadCommands.stdout);assert.equal(loadCommands.status,0,loadCommands.stderr);assert.deepEqual([...loadCommands.stdout.matchAll(/\bminos ([0-9.]+)/g)].map(match=>match[1]),['11.0','11.0']);
 const code=`const {createRequire}=require('node:module');const assert=require('node:assert/strict');const api=createRequire(process.cwd()+'/package.json')(process.argv[1]);assert.deepEqual(Reflect.ownKeys(api).sort(),['captureExistingOriginalRootPoolLedger','closeOriginalRootPoolLedgerSource','holdExistingOriginalRootPoolLedger']);for(const method of Reflect.ownKeys(api))assert.equal(typeof api[method],'function');assert.throws(()=>api.captureExistingOriginalRootPoolLedger(undefined),/ROOT_RESOURCE_ARGUMENT_INVALID/);api.closeOriginalRootPoolLedgerSource();console.log(JSON.stringify({node:process.versions.node,napi:process.versions.napi,exports:Reflect.ownKeys(api),wrongArgumentsRefused:true,noZeroArgumentRead:true}));`;
 const compatibility=[process.execPath,...(process.env.XIAOK_LEDGER_SOURCE_COMPAT_NODE?[process.env.XIAOK_LEDGER_SOURCE_COMPAT_NODE]:[])],smokes=[];
 for(const executable of compatibility){const child=spawnSync(executable,['-e',code,outputs[0]],{cwd:repo,encoding:'utf8',timeout:10000});writeFileSync(join(root,'default-source-smoke.json'),JSON.stringify({pid:child.pid,status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr},null,2));assert.equal(child.status,0,child.stderr);smokes.push(JSON.parse(child.stdout));}
 console.log(JSON.stringify({kind:'cold-source-production-artifact',root,bytes:readFileSync(outputs[0]).length,sha256:createHash('sha256').update(readFileSync(outputs[0])).digest('hex'),smokes,sameBytes:true,productionQualified:false}));
});
