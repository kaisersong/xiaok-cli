import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('actual Desktop build has the fixed cold ledger artifact loadable in Node and genuine Main',
 {skip:process.platform!=='darwin',timeout:30000},async()=>{
 const loader=join(repo,'desktop/dist/main/src/runtime/verification/original-root-ledger-source-loader.js'),binary=join(dirname(loader),'native/darwin-universal/root_resource_ledger_source.node');
 assert.equal(existsSync(loader),true,'run the original Desktop build:main first');assert.equal(existsSync(binary),true,'Desktop build must include its own fixed cold artifact');
 const root=mkdtempSync(join(tmpdir(),'desktop-cold-ledger-')),records=[],bytes=readFileSync(binary),sha=createHash('sha256').update(bytes).digest('hex');
 for(const name of ['userData','sessionData','crashDumps','config'])mkdirSync(join(root,name),{mode:0o700});
 const check=`const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');const module=await import(pathToFileURL(${JSON.stringify(loader)}).href);const api=module.loadOriginalRootLedgerSource();assert.equal(module.loadOriginalRootLedgerSource(),api);assert.ok(Object.isFrozen(api));assert.deepEqual(Reflect.ownKeys(api).sort(),['captureExistingOriginalRootPoolLedger','closeOriginalRootPoolLedgerSource','holdExistingOriginalRootPoolLedger']);assert.throws(()=>api.captureExistingOriginalRootPoolLedger(undefined),/ROOT_RESOURCE_ARGUMENT_INVALID/);assert.throws(()=>api.holdExistingOriginalRootPoolLedger(undefined),/ROOT_RESOURCE_ARGUMENT_INVALID/);api.closeOriginalRootPoolLedgerSource();`;
 function run(executable,args,env){const p=spawnSync(executable,args,{cwd:root,env,encoding:'utf8',timeout:12000});records.push({pid:p.pid,status:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr});writeFileSync(join(root,'runs.json'),JSON.stringify(records,null,2));assert.equal(p.error,undefined);assert.equal(p.signal,null);assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout.trim());}
 const node=run(process.execPath,['-e',`(async()=>{${check}console.log(JSON.stringify({node:process.versions.node,noZeroArgumentRead:true}));})().catch(e=>{console.error(e);process.exitCode=1;});`],{...process.env,XIAOK_CONFIG_DIR:join(root,'config')});
 const executable=await getNativeTestElectronExecutable(repo),entry=join(root,'entry.cjs');
 writeFileSync(entry,`const {app,BrowserWindow}=require('electron');const path=require('node:path');for(const name of ['userData','sessionData','crashDumps'])app.setPath(name,path.join(${JSON.stringify(root)},name));app.disableHardwareAcceleration();app.whenReady().then(async()=>{${check}assert.equal(process.type,'browser');assert.equal(BrowserWindow.getAllWindows().length,0);assert.equal(app.dock.isVisible(),false);console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,actualMain:true,windows:0,dockVisible:false,noZeroArgumentRead:true}));app.exit(0);}).catch(e=>{console.error(e);app.exit(1);});`);
 const env={...process.env,XIAOK_CONFIG_DIR:join(root,'config')};delete env.ELECTRON_RUN_AS_NODE;const main=run(executable,[entry],env);
 assert.deepEqual(readFileSync(binary),bytes);assert.equal(main.actualMain,true);assert.equal(main.windows,0);assert.equal(main.dockVisible,false);assert.equal(main.noZeroArgumentRead,true);assert.equal(node.noZeroArgumentRead,true);
 console.log(JSON.stringify({kind:'desktop-cold-ledger-artifact',root,sha256:sha,bytes:bytes.length,node,main,productionQualified:false,systemInstalled:false}));
});
