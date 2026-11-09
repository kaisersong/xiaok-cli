import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function compile(root,name){
 assert.ok(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,'actual Electron SDK headers required');
 const domain=join(root,name+'-domain'),addon=join(root,name+'.node');mkdirSync(domain);
 const result=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'embedded'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);return{domain,addon};
}
async function actual(root,mode,binary,foreign){
 const dir=join(root,mode);mkdirSync(dir);const electron=await getNativeTestElectronExecutable(repo),fixture=join(repo,'tests/native/fixtures/root-resource-main-source-keys.cjs'),result=join(dir,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;if(mode==='run-as-node')env.ELECTRON_RUN_AS_NODE='1';
 const exe=mode==='node'?process.execPath:electron,args=[fixture,mode,binary.addon,binary.domain,result,join(dir,'userData'),foreign?.addon||''];
 const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe']}),birth=spawnSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim(),row={mode,pid:child.pid,birth,argv:[exe,...args],signals:[],stdout:'',stderr:''};writeFileSync(join(dir,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',value=>{row.stdout+=value;});child.stderr.on('data',value=>{row.stderr+=value;});
 let escalation;const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);}},20000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}finally{clearTimeout(timer);clearTimeout(escalation);writeFileSync(join(dir,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({evidence:dir,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));return facts;
}
test('actual Main exposes the four fixed Source key API after original session birth',{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-main-keys-api-')),binary=compile(root,'main');await actual(root,'api',binary);console.log(JSON.stringify({root,notProductNQualification:true}));
});
test('actual four Source keys keep private class membership and original Main lifetime',{skip:process.platform!=='darwin',timeout:120000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-main-keys-')),binary=compile(root,'main'),foreign=compile(root,'foreign');
 for(const mode of ['run-as-node','node','main','closed','revoked','early-closed','early-revoked','unknown','gc'])await actual(root,mode,binary,foreign);
 console.log(JSON.stringify({root,notProductNQualification:true}));
});
test('portable original C target has no Main Source key factory or upgrade',{skip:process.platform!=='darwin',timeout:60000},()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-portable-no-keys-')),domain=join(root,'domain'),addon=join(root,'portable.node');mkdirSync(domain);
 const result=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'baseline'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const api=createRequire(import.meta.url)(addon);for(const name of ['RoomDiscussion','RoomProject','KSwarmDirect','WorkflowRoot','DshDraft']){assert.equal(api['takeOriginal'+name+'SourceKey'],undefined);assert.equal(api['assertOriginal'+name+'SourceKey'],undefined);}assert.equal(api.openOriginalMainIssuer,undefined);assert.equal(api.buildInfo().nativeQualified,false);
 const issuer=api.openOriginal();try{assert.equal(api.installFresh(issuer).installed,true);assert.equal(api.readPolicy(issuer).capacity,5);}finally{api.close(issuer);}console.log(JSON.stringify({root,portableMainKeysUnavailable:true,notProductNQualification:true}));
});
