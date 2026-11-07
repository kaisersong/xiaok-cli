import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(join(repo,'package.json'));
for(const scenario of ['normal','capacity','queued_cancel','held_failure','undefined_failure','held_children','sync_entry_fault'])test('original Room runtime consumes and physically finishes Native N: '+scenario,{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-native-room-launch-')),domain=join(root,'domain'),addon=join(root,'root_resource_authority_main.node'),bundle=join(root,'component.mjs');mkdirSync(domain);
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'embedded'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr||build.stdout);
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/room-discussion-launch-entry.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',banner:{js:"import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);"}});
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const electron=await getNativeTestElectronExecutable(repo),result=join(root,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 const args=[join(repo,'tests/native/fixtures/root-resource-room-discussion-launch.cjs'),bundle,domain,result,join(root,'userData'),resolve(repo,'../intent-broker/src/broker/service.js'),resolve(repo,'../intent-broker/src/http/server.js')];
 env.XIAOK_ROOM_LAUNCH_SCENARIO=scenario;const child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};
 row.birth=spawnSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim();writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));
 child.stdout.on('data',v=>{row.stdout+=v;});child.stderr.on('data',v=>{row.stderr+=v;});
 const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');}},45000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}finally{clearTimeout(timer);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({root,...row}));const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(row.code,0,JSON.stringify(facts));assert.deepEqual(row.signals,[]);
 assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));
});
