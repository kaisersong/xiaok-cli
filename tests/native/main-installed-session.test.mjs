import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('original early Main Native installation exposes only fixed opaque session operations',{skip:process.platform!=='darwin',timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-main-installed-session-')),addon=join(root,'main_bootstrap.node');
 mkdirSync(join(root,'config'),{mode:0o700});
 const built=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-bootstrap.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon],{encoding:'utf8'});assert.equal(built.status,0,built.stderr||built.stdout);
 const executable=await getNativeTestElectronExecutable(repo),env={...process.env,XIAOK_CONFIG_DIR:join(root,'config')};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const args=[join(repo,'tests/native/fixtures/main-installed-session.cjs'),addon,root],child=spawn(executable,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[executable,...args],stdout:'',stderr:'',signals:[]};writeFileSync(join(root,'birth.json'),JSON.stringify(row));child.stdout.on('data',v=>row.stdout+=v);child.stderr.on('data',v=>row.stderr+=v);
 const timer=setTimeout(()=>{row.signals.push('SIGTERM');child.kill('SIGTERM');},15000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});}finally{clearTimeout(timer);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2)+'\n');}
 console.log(JSON.stringify({root,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
 const facts=JSON.parse(readFileSync(join(root,'facts.json'),'utf8'));assert.equal(facts.actualMain,true);assert.equal(facts.installedApi,true);assert.equal(facts.foreignTraps,0);
});
