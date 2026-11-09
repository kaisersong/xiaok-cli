import {spawnSync} from 'node:child_process';
import {mkdirSync,realpathSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReadonlyLeafAssets} from './build-readonly-leaf-assets.mjs';
const [headersArg,outputArg,fixtureArg,mode,factsArg,installationArg]=process.argv.slice(2);
if(!headersArg||!outputArg||!fixtureArg||!['baseline','embedded',undefined].includes(mode)||process.platform!=='darwin')throw Error('MAIN_SESSION_BUILD_UNAVAILABLE');
const headers=resolve(headersArg),output=resolve(outputArg),fixture=realpathSync(fixtureArg),source=dirname(fileURLToPath(import.meta.url));
mkdirSync(dirname(output),{recursive:true});
const sdk=spawnSync('xcrun',['--show-sdk-path'],{encoding:'utf8'});if(sdk.status!==0)throw Error(sdk.stderr);
function build(exe,args){const row=spawnSync(exe,args,{encoding:'utf8'});if(row.status!==0){process.stderr.write(row.stderr||row.stdout);process.exit(row.status||1);}}
const installation=installationArg?['-DMI_FIXTURE_BUILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(realpathSync(installationArg))]:[];
const common=['-Werror','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-I',headers,...installation];
const c=output+'.c.o',cpp=output+'.cpp.o';
const leafHeader=await buildReadonlyLeafAssets(dirname(output));
build('cc',[...common,'-std=c11','-DNAPI_VERSION=8','-DNR_FIXTURE_BUILD=1','-DNR_READONLY_LEAF_ASSETS_HEADER='+JSON.stringify(realpathSync(leafHeader)),'-DNR_FIXTURE_ROOT='+JSON.stringify(fixture),...(factsArg&&factsArg!=='-'?['-DNR_FIXTURE_FACTS_HEADER='+JSON.stringify(realpathSync(factsArg))]:[]),...(mode==='baseline'?[]:['-DNR_MAIN_BOOTSTRAP_EMBEDDED=1']),'-c',join(source,'root_resource_authority.c'),'-o',c]);
if(mode!=='baseline')build('c++',[...common,'-std=c++20','-DNAPI_VERSION=8','-DNR_MAIN_BOOTSTRAP_EMBEDDED=1','-DNODE_GYP_MODULE_NAME=root_resource_authority_main','-DV8_COMPRESS_POINTERS','-DV8_ENABLE_SANDBOX','-c',join(source,'main-bootstrap.cc'),'-o',cpp]);
const installed=[];
if(mode!=='baseline'){
 const client=output+'.client.o',wire=output+'.wire.o';
 build('cc',[...common,'-std=c11','-c',join(source,'installed-main-client.c'),'-o',client]);
 build('cc',[...common,'-std=c11','-c',join(source,'../main-installation/wire.c'),'-o',wire]);const vfs=output+'.vfs.o';
 build('cc',[...common,'-std=c11','-c',join(source,'original-root-io-vfs.c'),'-o',vfs]);installed.push(client,wire,vfs);
}
build('c++',['-bundle','-undefined','dynamic_lookup',c,...(mode==='baseline'?[]:[cpp]),...installed,'-lsqlite3',...(mode==='baseline'?[]:['-framework','Security','-lbsm']),'-o',output]);
