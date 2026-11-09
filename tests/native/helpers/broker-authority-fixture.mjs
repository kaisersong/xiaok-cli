import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export async function runOriginalBrokerComponent(launch,skipClose=false){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'broker-native-component-')));mkdirSync(join(root,'config'),{mode:0o700});
 const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:30000,...options});console.log(JSON.stringify({brokerNativeBuild:{pid:r.pid,status:r.status,signal:r.signal,command}}));assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const sources=()=>[...new Set([...run('git',['ls-files','--','native']).trim().split('\n'),...run('git',['ls-files','--others','--exclude-standard','--','native']).trim().split('\n'),'tests/native/fixtures/broker-authority-child-live.c','tests/native/fixtures/broker-authority-delegated.c'])].filter(x=>/\.(c|cc|h|cjs|gyp)$/.test(x)).sort();
 const capture=()=>Object.fromEntries(sources().map(p=>[p,hash(join(repo,p))]));const before=capture();
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation');const child=join(root,'child'),launcher=join(root,'launcher'),helper=join(root,'helper'),broker=join(root,'broker'),brokerLauncher=join(root,'broker-launcher'),config=join(root,'configuration.h');
 let brokerHash='0'.repeat(64);
 const configure=mainHash=>writeFileSync(config,'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n'+[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',child],['MI_MAIN_BUNDLE',child],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',mainHash],['MI_BROKER_LAUNCHER_EXEC',brokerLauncher],['MI_BROKER_EXEC',broker],['MI_EXPECTED_BROKER_SHA256',brokerHash]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join(''));
 const build=(inputs,out)=>{run('/usr/bin/cc',['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',native,'-I',wire,'-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1',...(launch?['-DMI_FIXTURE_BROKER_COMPONENT=1','-DMI_FIXTURE_BROKER_RUN_CHILD=1']:[]),...(skipClose?['-DMI_FIXTURE_BROKER_SKIP_CLOSE=1']:[]),'-DMI_CONFIGURATION_HEADER='+JSON.stringify(config),...inputs,'-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',out]);chmodSync(out,0o500);};
 let p,actual;try{
  configure('0'.repeat(64));
  if(launch){build([join(repo,'tests/native/fixtures/broker-authority-delegated.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],broker);brokerHash=hash(broker);configure('0'.repeat(64));build([join(repo,'native/broker-authority-source/broker-child-launcher.c'),join(wire,'wire.c')],brokerLauncher);}
  build([join(repo,'tests/native/fixtures/broker-authority-child-live.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],child);configure(hash(child));
  build([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);build([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);
  assert.deepEqual(capture(),before);console.log(JSON.stringify({sourceHashes:before,componentArtifacts:Object.fromEntries([child,launcher,helper,...(launch?[broker,brokerLauncher]:[])].map(p=>[p,hash(p)])),productionQualified:false}));
  p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});actual={pid:p.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};console.log(JSON.stringify({brokerNativeHelperBirth:{pid:p.pid,root}}));
  p.stdout.on('data',b=>actual.stdout+=b);p.stderr.on('data',b=>actual.stderr+=b);
  const joined=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});
  const timer=setTimeout(()=>p.kill('SIGTERM'),20000);
  try{await joined;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await joined;}}
  console.log(JSON.stringify({brokerNativeHelperJoined:actual}));assert.equal(actual.signal,null,actual.stderr);assert.equal(actual.code,0,actual.stderr+'\n'+actual.stdout);assert.deepEqual(capture(),before);
  return actual.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
 }finally{if(p&&!actual?.reaped)p.kill('SIGTERM');rmSync(root,{recursive:true,force:true});}
}
