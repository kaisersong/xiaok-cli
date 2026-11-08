// Fixed test build recipe only; no Main/helper launch or installation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync,existsSync,realpathSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function buildDualMainNative({repo,headers,root,executable,node,kswarm,broker}){
 const sources={},builds=[],hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),facade=join(repo,'native/protected-sqlite-facade'),ks=join(repo,'native/kswarm-authority-source'),br=join(repo,'native/broker-authority-source');
 const include=[headers,native,wire,facade,ks,br];
 function capture(file){file=realpathSync(file);if(sources[file])return;const st=statSync(file,{bigint:true});sources[file]={sha256:hash(file),bytes:Number(st.size),mtimeNs:String(st.mtimeNs)};if(/\.(c|cc|h)$/.test(file))for(const m of readFileSync(file,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const next=[resolve(dirname(file),m[1]),...include.map(dir=>join(dir,m[1]))].find(existsSync);assert.ok(next,'fixed build include missing');capture(next);}}
 const standalone=join(root,'main_bootstrap.node'),embedded=join(root,'root_resource_authority_main.node'),helper=join(root,'helper'),launcher=join(root,'launcher'),entry=join(root,'entry.cjs'),configuration=join(root,'configuration.h');
 const ksLauncher=join(root,'kswarm-child-launcher'),brLauncher=join(root,'broker-child-launcher');
 const values=[['MI_FIXED_ROOT',root],['MI_LAUNCHER_EXEC',launcher],['MI_MAIN_EXEC',executable],['MI_MAIN_BUNDLE',dirname(dirname(dirname(executable)))],['MI_EXPECTED_MAIN_SHA256',hash(executable)],['MI_FIXTURE_MAIN_ENTRY',entry],['MI_KSWARM_LAUNCHER_EXEC',ksLauncher],['MI_KSWARM_EXEC',node],['MI_KSWARM_ENTRY',join(kswarm,'src/server/original-authority-bootstrap.js')],['MI_EXPECTED_KSWARM_SHA256',hash(node)],['MI_BROKER_LAUNCHER_EXEC',brLauncher],['MI_BROKER_EXEC',node],['MI_BROKER_ENTRY',join(broker,'src/runtime/original-authority-bootstrap.js')],['MI_EXPECTED_BROKER_SHA256',hash(node)]];
 writeFileSync(configuration,values.map(([name,value])=>`#define ${name} ${JSON.stringify(value)}\n`).join('')+'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n#define NR_MAIN_DSH_SERVICE_COMPONENT 1\n');
 function build(command,args){const result=spawnSync(command,args,{cwd:repo,encoding:'utf8'});builds.push({command,args,pid:result.pid,status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr});writeFileSync(join(root,'dual-builds.json'),JSON.stringify(builds,null,2)+'\n');if(result.error)throw result.error;assert.equal(result.status,0,result.stderr||result.stdout);}
 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});builds.push({command:'/usr/bin/xcrun',args:['--show-sdk-path'],pid:sdk.pid,status:sdk.status,signal:sdk.signal,stdout:sdk.stdout,stderr:sdk.stderr});assert.equal(sdk.status,0,sdk.stderr);
 const common=['-std=c11','-Werror','-Wall','-Wextra','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),...include.flatMap(dir=>['-I',dir]),'-DNAPI_VERSION=8','-DMI_FIXTURE_BUILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration)],frameworks=['-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm'];
 for(const file of ['build-main-bootstrap.mjs','build-main-session.mjs'])capture(join(native,file));
 build(process.execPath,[join(native,'build-main-bootstrap.mjs'),headers,standalone,configuration]);build(process.execPath,[join(native,'build-main-session.mjs'),headers,embedded,join(root,'pool'),'embedded','-',configuration]);
 for(const [file,out]of [[join(wire,'main-installation-entry.c'),launcher],[join(wire,'main-installation-helper.c'),helper],[join(ks,'kswarm-child-launcher.c'),ksLauncher],[join(br,'broker-child-launcher.c'),brLauncher]]){capture(file);capture(join(wire,'wire.c'));build('/usr/bin/cc',[...common,file,join(wire,'wire.c'),...frameworks,'-o',out]);}
 for(const [source,destination]of [[ks,kswarm],[br,broker]]){
  const runtime=join(destination,'runtime'),files=[join(source,source===ks?'kswarm-child-addon.c':'broker-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')];for(const file of files)capture(file);
  build('/usr/bin/cc',[...common,'-bundle','-undefined','dynamic_lookup',...files,'-lsqlite3',...frameworks,'-o',join(runtime,'protected_sqlite.node')]);
  for(const [file,name]of [[join(facade,'index.cjs'),'index.cjs'],[join(source,'original-authority-sqlite.cjs'),'original-authority-sqlite.cjs']]){capture(file);copyFileSync(file,join(runtime,name));}
  const runtimeBuild=join(repo,'native/sidecar-source-runtime/build.mjs');capture(runtimeBuild);build(process.execPath,[runtimeBuild,join(runtime,'xiaok-source-runtime.cjs')]);const graph=JSON.parse(readFileSync(join(runtime,'xiaok-source-runtime.cjs.manifest.json'),'utf8'));for(const file of Object.keys(graph.inputs))capture(file);
 }
 return {standalone,embedded,helper,launcher,entry,configuration,ksLauncher,brLauncher,sources,builds};
}
export async function buildDualMainFacade(repo,headers,root,configuration,executable){
 const {buildMainProtectedSqliteFixture}=await import(pathToFileURL(join(repo,'tests/native/helpers/main-protected-sqlite-fixture.mjs')).href);
 return buildMainProtectedSqliteFixture(repo,headers,join(root,'protected_sqlite.node'),configuration,{electronExecutable:executable});
}
