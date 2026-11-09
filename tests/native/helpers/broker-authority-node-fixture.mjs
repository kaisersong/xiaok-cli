import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,chmodSync,rmSync,cpSync,existsSync,copyFileSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export async function runOriginalBrokerNode({referenceFault=false,withoutBirth=false}={}){
 const headers=process.env.XIAOK_BROKER_TEST_NODE_HEADERS?realpathSync(process.env.XIAOK_BROKER_TEST_NODE_HEADERS):resolve(dirname(realpathSync(process.execPath)),'../include/node');
 assert.ok(existsSync(join(headers,'node_api.h')),'build-time NodeAPI headers required');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'broker-native-node-'))),runtime=join(root,'runtime');mkdirSync(runtime);mkdirSync(join(root,'config'),{mode:0o700});
 const env={...process.env,XIAOK_CONFIG_DIR:join(root,'config')};
 const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:30000,...options});console.log(JSON.stringify({brokerNodeBuild:{pid:r.pid,status:r.status,signal:r.signal,command}}));assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),facade=join(repo,'native/protected-sqlite-facade'),source=join(repo,'native/broker-authority-source');
 const paths=[join(source,'broker-child-addon.c'),join(source,'original-authority-sqlite.cjs'),join(facade,'index.cjs'),join(facade,'protected-sqlite-facade.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')];let before;
 const node=join(root,'node');
 const parent=join(root,'main-child'),launcher=join(root,'main-launcher'),helper=join(root,'helper'),brokerLauncher=join(root,'broker-launcher'),entry=join(root,'entry.cjs'),config=join(root,'configuration.h');
 const configure=mainHash=>writeFileSync(config,'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n'+[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',parent],['MI_MAIN_BUNDLE',parent],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',mainHash],['MI_BROKER_LAUNCHER_EXEC',brokerLauncher],['MI_BROKER_EXEC',node],['MI_BROKER_ENTRY',entry],['MI_EXPECTED_BROKER_SHA256',hash(node)]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join(''));
 const common=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',native,'-I',wire,'-I',facade,'-I',source,'-I',headers,'-DNAPI_VERSION=8','-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DMI_FIXTURE_BROKER_RUN_CHILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(config)];
 const build=(inputs,out,module=false)=>{run('/usr/bin/cc',[...common,...(module?['-bundle','-undefined','dynamic_lookup']:[]),...inputs,'-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',out]);chmodSync(out,0o500);};
 let p,actual;
 try{
  before=paths.map(hash);
  copyFileSync(realpathSync(process.execPath),node,constants.COPYFILE_FICLONE);chmodSync(node,0o500);assert.equal(hash(node),hash(realpathSync(process.execPath)));
  configure('0'.repeat(64));cpSync(join(facade,'index.cjs'),join(runtime,'index.cjs'));cpSync(join(source,'original-authority-sqlite.cjs'),join(runtime,'original-authority-sqlite.cjs'));
  build([referenceFault?join(repo,'tests/native/fixtures/broker-addon-ref-fault.c'):join(source,'broker-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],join(runtime,'protected_sqlite.node'),true);
  if(withoutBirth){
   const code="const a=require('node:assert/strict'),n=require('./runtime/protected_sqlite.node');a.equal(n.readOriginalBrokerSource(),undefined);const fixed=require('./runtime/original-authority-sqlite.cjs');a.equal(fixed.namespace,null);a.throws(()=>n.consumeOriginalBrokerSource());a.throws(()=>n.consumeOriginalBrokerSource());a.equal(n.finishOriginalBrokerSource(),undefined);console.log(JSON.stringify({kind:'broker-no-seed-rejected',nativeConsumed:false,productionQualified:false}));";
   const result=JSON.parse(run(process.execPath,['-e',code]));assert.deepEqual(paths.map(hash),before);return [result];
  }
  cpSync(join(repo,'tests/native/fixtures',referenceFault?'broker-authority-node-ref-fault.cjs':'broker-authority-node.cjs'),entry);
  build([join(repo,'tests/native/fixtures/broker-authority-child-live.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],parent);configure(hash(parent));
  build([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);build([join(source,'broker-child-launcher.c'),join(wire,'wire.c')],brokerLauncher);build([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);
  assert.deepEqual(paths.map(hash),before);console.log(JSON.stringify({nodeComponentInputs:Object.fromEntries(paths.map((p,i)=>[p,before[i]])),nodeExecutable:realpathSync(process.execPath),nodeSha256:hash(realpathSync(process.execPath)),productionQualified:false}));
  p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});actual={pid:p.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};console.log(JSON.stringify({brokerNodeHelperBirth:{pid:p.pid,root}}));p.stdout.on('data',b=>actual.stdout+=b);p.stderr.on('data',b=>actual.stderr+=b);
  const joined=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>p.kill('SIGTERM'),20000);
  try{await joined;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await joined;}}
  console.log(JSON.stringify({brokerNodeHelperJoined:actual}));assert.equal(actual.signal,null,actual.stderr);assert.equal(actual.code,0,actual.stderr+'\n'+actual.stdout);assert.deepEqual(paths.map(hash),before);return actual.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
 }finally{if(p&&!actual?.reaped)p.kill('SIGTERM');rmSync(root,{recursive:true,force:true});}
}
