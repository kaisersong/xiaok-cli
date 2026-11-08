import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,chmodSync,rmSync,copyFileSync,constants,statSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export async function runOriginalBrokerProtectedSource(mode){
 const headers=realpathSync(process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(realpathSync(process.execPath)),'../include/node'));
 const version=readFileSync(join(headers,'node_version.h'),'utf8');assert.equal(['MAJOR','MINOR','PATCH'].map(v=>version.match(new RegExp('^#define NODE_'+v+'_VERSION (\\d+)','m'))?.[1]).join('.'),process.versions.node,'actual Node V8 SDK required');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'broker-protected-source-'))),config=join(root,'config'),runtime=join(root,'runtime');mkdirSync(config,{mode:0o700});mkdirSync(runtime);
 const node=join(root,'node'),native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),facade=join(repo,'native/protected-sqlite-facade'),broker=join(repo,'native/broker-authority-source');
 const configuration=join(root,'configuration.h'),launcher=join(root,'launcher'),helper=join(root,'helper'),childLauncher=join(root,'broker-launcher'),entry=join(root,'entry.cjs'),binary=join(root,'main_bootstrap.node'),main=join(root,'main.cjs');
 const sources={},include=[native,wire,facade,broker,headers];
 function source(path){path=realpathSync(path);if(sources[path])return;sources[path]=hash(path);if(/\.(c|cc|h)$/.test(path))for(const m of readFileSync(path,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const found=[resolve(dirname(path),m[1]),...include.map(v=>join(v,m[1]))].find(existsSync);if(found)source(found);}}
 const check=()=>{for(const [path,sha]of Object.entries(sources))assert.equal(hash(path),sha,'source changed '+path);};
 const builds=[];let p,actual;
 try{
  copyFileSync(realpathSync(process.execPath),node,constants.COPYFILE_FICLONE);chmodSync(node,0o500);assert.equal(hash(node),hash(realpathSync(process.execPath)));
  writeFileSync(configuration,'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n'+[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',node],['MI_MAIN_BUNDLE',node],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',hash(node)],['MI_FIXTURE_MAIN_ENTRY',main],['MI_BROKER_LAUNCHER_EXEC',childLauncher],['MI_BROKER_EXEC',node],['MI_BROKER_ENTRY',entry],['MI_EXPECTED_BROKER_SHA256',hash(node)]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join(''));
  const inputs=[join(native,'main-bootstrap.cc'),join(native,'installed-main-client.c'),join(wire,'wire.c'),join(wire,'main-installation-entry.c'),join(wire,'main-installation-helper.c'),join(broker,'broker-child-launcher.c'),join(broker,'broker-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(facade,'index.cjs'),join(broker,'original-authority-sqlite.cjs'),join(repo,'tests/native/fixtures/broker-source-node.cjs'),join(repo,'tests/native/fixtures/broker-source-parent.cjs')];for(const path of inputs)source(path);
  const common=['-Werror','-Wno-deprecated-declarations',...include.flatMap(v=>['-I',v]),'-DNAPI_VERSION=8','-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DNR_MAIN_INSTALLATION_COMPONENT=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration)];
  const build=(command,args)=>{const r=spawnSync(command,args,{cwd:root,env:{...process.env,XIAOK_CONFIG_DIR:config},encoding:'utf8',timeout:30000});builds.push({pid:r.pid,command,args,status:r.status,signal:r.signal,stderr:r.stderr,error:r.error?.message});writeFileSync(join(root,'builds.json'),JSON.stringify(builds,null,2));assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);};
  const c=(files,out,extra=[])=>{build('/usr/bin/cc',[...common,'-std=c11',...files,...extra,...(extra.includes('-c')?[]:['-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm']),'-o',out]);chmodSync(out,0o500);};
  c([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);c([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);c([join(broker,'broker-child-launcher.c'),join(wire,'wire.c')],childLauncher);
  c([join(broker,'broker-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],join(runtime,'protected_sqlite.node'),['-bundle','-undefined','dynamic_lookup']);
  copyFileSync(join(facade,'index.cjs'),join(runtime,'index.cjs'));copyFileSync(join(broker,'original-authority-sqlite.cjs'),join(runtime,'original-authority-sqlite.cjs'));copyFileSync(join(repo,'tests/native/fixtures/broker-source-node.cjs'),entry);
  const objects=[];for(const path of [join(native,'installed-main-client.c'),join(wire,'wire.c')]){const object=join(root,'parent-'+objects.length+'.o');c([path],object,['-c']);objects.push(object);}
  build('/usr/bin/c++',[...common,...(mode==='allocation-fault'?['-DNR_BROKER_PORT_ALLOCATION_FAULT=1']:[]),'-std=c++20','-bundle','-undefined','dynamic_lookup',...(process.config.variables.v8_enable_pointer_compression?['-DV8_COMPRESS_POINTERS']:[]),...(process.config.variables.v8_enable_sandbox?['-DV8_ENABLE_SANDBOX']:[]),join(native,'main-bootstrap.cc'),...objects,'-framework','Security','-lbsm','-o',binary]);
  const {build:bundle}=await import('esbuild');const bundled=await bundle({entryPoints:[join(repo,'desktop/electron/broker-protected-child.ts')],bundle:true,platform:'node',format:'esm',target:'node22',outfile:join(root,'source.mjs'),metafile:true});for(const path of Object.keys(bundled.metafile.inputs))source(resolve(repo,path));
  writeFileSync(main,`require(${JSON.stringify(join(repo,'tests/native/fixtures/broker-source-parent.cjs'))})(${JSON.stringify({mode,config,binary,result:join(root,'facts.json')})}).catch(raw=>{globalThis.originalBrokerPortFailure={raw};console.error(raw);process.exitCode=1;});\n`);
  check();writeFileSync(join(root,'source-manifest.json'),JSON.stringify(sources,null,2));
  p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:config},stdio:['ignore','pipe','pipe']});actual={pid:p.pid,root,stdout:'',stderr:'',reaped:false};console.log(JSON.stringify({brokerParentHelperBirth:{pid:p.pid,root}}));
  p.stdout.on('data',v=>actual.stdout+=v);p.stderr.on('data',v=>actual.stderr+=v);
  const closed=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>p.kill('SIGTERM'),20000);
  try{await closed;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await closed;}}
  check();writeFileSync(join(root,'run.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify({brokerParentHelperJoined:actual}));return actual;
 }finally{
  (await import('esbuild')).stop();
  // Retain failed fixture DB/receipt/error facts. Only an unspawned/reaped owned executable
  // may be recovered; deleting it is not a claim of physical Source completion.
  if((!p||actual?.reaped)&&existsSync(node)){
   const used=spawnSync('/usr/sbin/lsof',[node],{encoding:'utf8'});
   if(used.status===1&&!used.stdout&&statSync(node).uid===process.getuid()&&hash(node)===hash(realpathSync(process.execPath))){rmSync(node);writeFileSync(join(root,'owned-node-retirement.json'),JSON.stringify({path:node,lsofStatus:used.status,onlyOwnedCopy:true,physicalSourceQualification:false}));}
  }
 }
}
