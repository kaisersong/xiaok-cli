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
async function actual(mode){
 const root=mkdtempSync(join(tmpdir(),'xiaok-native-room-')),domain=join(root,'domain'),addon=join(root,'main.node');
 mkdirSync(domain);
 assert.ok(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS);
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'embedded'],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.stdout);
 const electron=await getNativeTestElectronExecutable(repo),result=join(root,'facts.json');
 const env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 const args=[join(repo,'tests/native/fixtures/root-resource-main-room-subject.cjs'),addon,domain,result,join(root,'userData'),mode];
 const child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};
 row.birth=spawnSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim();
 writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));
 child.stdout.on('data',v=>{row.stdout+=v;});child.stderr.on('data',v=>{row.stderr+=v;});
 const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');}},20000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}
 finally{clearTimeout(timer);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({root,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
 const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));return facts;
}
test('actual original Main has fixed room subject primitive entry',{skip:process.platform!=='darwin',timeout:60000},()=>actual('api'));
test('actual original room key produces stable v2 resource without DTO authority',{skip:process.platform!=='darwin',timeout:60000},()=>actual('full'));

test('actual original Main has fixed DshDraft key and subject API',{skip:process.platform!=='darwin',timeout:60000},()=>actual('dsh-api'));
test('actual DshDraft v2 includes original commit identity and safe negative settlement',{skip:process.platform!=='darwin',timeout:60000},()=>actual('dsh-full'));

test('actual original Main has physical M/P API',{skip:process.platform!=='darwin',timeout:60000},()=>actual('physical-api'));
test('actual Native M/P are independent bounded domains with once settlement',{skip:process.platform!=='darwin',timeout:60000},()=>actual('physical-full'));

test('actual Main has remaining fixed business Native imports',{skip:process.platform!=='darwin',timeout:60000},()=>actual('business-api'));
test('actual three business primitive boundaries share original N accounting',{skip:process.platform!=='darwin',timeout:60000},()=>actual('business-full'));

test('actual N finishes only original consumed member and reuses capacity',{skip:process.platform!=='darwin',timeout:60000},()=>actual('finish'));
