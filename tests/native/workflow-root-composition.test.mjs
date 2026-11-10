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
for(const mode of ['single','dual','queued-revoked'])test('actual Main workflow '+mode+' uses one original Native root, a bounded resident Worker and the same child carrier',{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-native-workflow-composition-')),domain=join(root,'domain'),addon=join(root,'root_resource_authority_main.node'),bundle=join(root,'component.mjs');mkdirSync(domain);
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'embedded'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr||build.stdout);
 const banner={js:"import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);"};
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/workflow-root-composition-entry.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',banner});
 await require('esbuild').build({entryPoints:[join(repo,'desktop/electron/workflow-script-runtime-worker.ts')],outfile:join(root,'workflow-script-runtime-worker.js'),bundle:true,platform:'node',format:'esm',packages:'external',banner});
 writeFileSync(join(root,'package.json'),'{"type":"module"}');symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const electron=await getNativeTestElectronExecutable(repo),result=join(root,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 const args=[join(repo,'tests/native/fixtures/workflow-root-composition.cjs'),bundle,domain,result,join(root,'userData'),repo,mode],child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',v=>{row.stdout+=v;});child.stderr.on('data',v=>{row.stderr+=v;});
 let escalation;const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);}},30000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}finally{clearTimeout(timer);clearTimeout(escalation);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({root,...row}));const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(row.code,0,JSON.stringify(facts));assert.deepEqual(row.signals,[]);assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));
});
