import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const repository=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const service=join(repository,'services','continuity-native');
const sha=b=>createHash('sha256').update(b).digest('hex');
const importReader=directory=>import(pathToFileURL(join(directory,'script','recipe-patches.mjs')).href);
const originalPins={restricted:['6e9407a35382f0a15220522c5fd479d3fe56b79e1163990116bd758c38382974',50757],'auth-owner':['dcc1840de528c12e003625a438f79515279300b018dfc62618317ec62d8efba0',308055],'auth-snapshot':['e5ff64d60e7b7683ebfa93480b42ec9e398137bf7a9dfee4eafdb987c4e89560',31111]};
function directory(t){const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'native-recipe-source-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:3}));return root;}
function clone(t){const root=join(directory(t),'component');fs.cpSync(service,root,{recursive:true});return root;}
function firstPart(root){const dir=join(root,'recipe-patches','restricted'),manifest=JSON.parse(fs.readFileSync(join(dir,'manifest.json'),'utf8'));return join(dir,manifest.parts[0].name);}
test('real recipe reader reconstructs every original pinned Rust patch without a Native qualification',async()=>{
 const {readPinnedRecipePatch}=await importReader(service);
 for(const [role,[digest,length]]of Object.entries(originalPins)){const bytes=readPinnedRecipePatch(role);assert.equal(bytes.length,length);assert.equal(sha(bytes),digest);}
});
test('current false gates and historical records reconstruct original JSON while Node24 remains separate from CLI floor',()=>{
 const recipe=JSON.parse(fs.readFileSync(join(service,'auth-owner.json'),'utf8')),history=JSON.parse(fs.readFileSync(join(service,'auth-owner-history.json'),'utf8')),order=JSON.parse(fs.readFileSync(join(service,'auth-owner-record-order.json'),'utf8'));
 for(const name of ['physicalManagedOAuthQualified','privateVaultAndLifetimeLockQualified','workerCredentialLeaseAndFinalStdinQualified','fullHarnessQualified'])assert.equal(recipe[name],false);
 const recovered=Object.fromEntries(order.keys.map(name=>[name,Object.hasOwn(recipe,name)?recipe[name]:history[name]]));
 assert.equal(sha(JSON.stringify(recovered,null,2)+'\n'),order.originalSHA256);
 assert.equal(order.originalSHA256,'e17e0bcfb9ee1b577ef1d20813ce2d1f62b26469a968593e9fb9cab372dbd257');
 assert.equal(JSON.parse(fs.readFileSync(join(service,'package.json'),'utf8')).engines.node,'>=24.0.0');
});
test('a modified source fragment cannot be accepted as the same original patch',async t=>{
 const root=clone(t),file=firstPart(root),bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);
 const {readPinnedRecipePatch}=await importReader(root);assert.throws(()=>readPinnedRecipePatch('restricted'),/native_recipe_part_changed/);
});
test('a hardlink source alias fails closed even when its bytes have the expected digest',async t=>{
 const root=clone(t),file=firstPart(root);fs.linkSync(file,join(root,'same-bytes-alias'));
 const {readPinnedRecipePatch}=await importReader(root);assert.throws(()=>readPinnedRecipePatch('restricted'),/native_recipe_source_alias/);
});
test('closed role selection refuses inherited names and a Proxy without triggering it',async()=>{
 const {readPinnedRecipePatch}=await importReader(service);let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('must not inspect caller');}});
 for(const role of ['__proto__','constructor','unknown',proxy])assert.throws(()=>readPinnedRecipePatch(role),/native_recipe_role_rejected/);assert.equal(traps,0);
});
test('both actual recipe CLIs reject unknown arguments before any build birth',()=>{
 for(const entry of ['build.mjs','build-auth-owner.mjs']){const result=spawnSync(process.execPath,[join(service,'script',entry),'--not-a-recipe-option','value'],{encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/invalid_build_arguments/);assert.doesNotMatch(result.stderr,/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);}
});
test('actual compiler/platform preflight cannot produce a Native artifact from the current Node executable',t=>{
 const root=directory(t),result=spawnSync(process.execPath,[join(service,'script','build.mjs'),'--build-root',root,'--cargo',process.execPath,'--rustc',process.execPath],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.doesNotMatch(result.stderr,/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
 if(process.platform==='darwin'&&process.arch==='arm64'){
  assert.match(result.stderr,/native_compiler_version_mismatch/);
  const jobs=fs.readdirSync(root);assert.equal(jobs.length,1);const job=join(root,jobs[0]);assert.equal(fs.existsSync(join(job,'artifact.json')),false);
  const state=JSON.parse(fs.readFileSync(join(job,'build-processes.json'),'utf8'));assert.equal(state.status,'failed');assert.equal(state.processes.length,1);assert.equal(state.processes[0].name,'cargo-version');assert.equal(state.processes[0].reaped,true);
 }else{assert.match(result.stderr,/native_build_platform_unqualified/);assert.deepEqual(fs.readdirSync(root),[]);}
});
