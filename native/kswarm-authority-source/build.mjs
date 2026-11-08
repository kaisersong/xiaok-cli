import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,realpathSync,statSync,chmodSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
// Build inputs only: no runtime entry accepts these paths or a fixture key.
if(process.platform!=='darwin'||process.argv.length!==5)throw Error('KSWARM_AUTHORITY_BUILD_REQUIRES_DARWIN_HEADERS_OUTPUT_TARGET_DEPENDENCY');
const source=dirname(fileURLToPath(import.meta.url)),repo=resolve(source,'../..');
const headers=realpathSync(process.argv[2]),output=resolve(process.argv[3]),dependency=realpathSync(process.argv[4]);
if(!statSync(join(headers,'node_api.h')).isFile())throw Error('KSWARM_AUTHORITY_NODE_API_HEADERS_REQUIRED');
mkdirSync(output,{recursive:true});
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),inputs=new Map(),runs=[];
const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),facade=join(repo,'native/protected-sqlite-facade');
function capture(path){path=realpathSync(path);if(inputs.has(path))return;const st=statSync(path,{bigint:true});inputs.set(path,{sha256:hash(path),bytes:Number(st.size),mtimeNs:String(st.mtimeNs)});for(const match of readFileSync(path,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const local=[resolve(dirname(path),match[1]),...[native,wire,facade,source,headers].map(dir=>join(dir,match[1]))].find(existsSync);if(!local)throw Error('KSWARM_AUTHORITY_INCLUDE_MISSING');capture(local);}}
const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});if(sdk.status!==0)throw Error(sdk.stderr||'KSWARM_AUTHORITY_MACOS_SDK_REQUIRED');
function run(command,args){const value=spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:60000});runs.push({command,args,pid:value.pid,status:value.status,signal:value.signal,stdout:value.stdout,stderr:value.stderr});writeFileSync(join(output,'build-runs.json'),JSON.stringify(runs,null,2));if(value.error)throw value.error;if(value.status!==0)throw Error(value.stderr||value.stdout||'KSWARM_AUTHORITY_BUILD_FAILED');}
const common=['-arch','arm64','-arch','x86_64','-Werror','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-std=c11','-I',headers,'-I',native,'-I',wire,'-I',facade,'-I',source,'-DNAPI_VERSION=8'];
const addonSources=[join(source,'kswarm-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')];
for(const path of [...addonSources,join(source,'kswarm-child-launcher.c')])capture(path);
run('/usr/bin/cc',[...common,'-bundle','-undefined','dynamic_lookup',...addonSources,'-lsqlite3','-framework','Security','-lbsm','-o',join(output,'protected_sqlite.node')]);
run('/usr/bin/cc',[...common,join(source,'kswarm-child-launcher.c'),join(wire,'wire.c'),'-framework','Security','-lbsm','-o',join(output,'kswarm-child-launcher')]);chmodSync(join(output,'kswarm-child-launcher'),0o500);
for(const [from,to]of [[join(facade,'index.cjs'),'index.cjs'],[join(source,'original-authority-sqlite.cjs'),'original-authority-sqlite.cjs']]){capture(from);copyFileSync(from,join(output,to));}
run(process.execPath,[join(repo,'native/sidecar-source-runtime/build.mjs'),join(output,'xiaok-source-runtime.cjs')]);
run(process.execPath,[join(repo,'native/sidecar-source-runtime/package-dependencies.mjs'),output,dependency]);
// This actual host/target check is separate from copying a dependency archive.
// No app is launched; the selected runtime here is this existing Node process.
run(process.execPath,['-e',`const p=require('node:path'),fs=require('node:fs');const D=require(p.join(process.argv[1],'node_modules/better-sqlite3'));const db=new D(':memory:');if(db.prepare('select 1 as n').get().n!==1)throw Error('dependency ABI failed');db.close();console.log(JSON.stringify({node:process.versions.node,modules:process.versions.modules,actualMemoryQuery:true,qualification:false}));`,output]);
for(const [path,before]of inputs){const st=statSync(path,{bigint:true});if(hash(path)!==before.sha256||String(st.mtimeNs)!==before.mtimeNs)throw Error('KSWARM_AUTHORITY_BUILD_SOURCE_DRIFT');}
const files=['protected_sqlite.node','kswarm-child-launcher','index.cjs','original-authority-sqlite.cjs','xiaok-source-runtime.cjs','dependency-manifest.json'].map(name=>({path:name,sha256:hash(join(output,name)),bytes:statSync(join(output,name)).size}));
writeFileSync(join(output,'source-manifest.json'),JSON.stringify({kind:'original_kswarm_authority_build_v1',platform:process.platform,arch:'darwin-universal',runtimeVerifiedArch:process.arch,node:process.versions.node,qualification:false,fixture:false,inputs:Object.fromEntries(inputs),files},null,2)+'\n');
console.log(JSON.stringify({output,files:files.length,actualDependencyHostAbiVerified:true,qualification:false,systemInstallationPerformed:false}));
