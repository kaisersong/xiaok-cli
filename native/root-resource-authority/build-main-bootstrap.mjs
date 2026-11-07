import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Build inputs are SDK/artifact locations, never runtime identity or grants.
const args=process.argv.slice(2);
if((args.length!==2&&args.length!==3)||process.platform!=='darwin')throw Error('MAIN_BOOTSTRAP_BUILD_UNAVAILABLE');
const [headers,output,configuration]=args.map(value=>resolve(value));
const installation=configuration?['-DMI_FIXTURE_BUILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration)]:[];
if(!existsSync(resolve(headers,'node.h')))throw Error('MAIN_BOOTSTRAP_ELECTRON_HEADERS_REQUIRED');
mkdirSync(dirname(output),{recursive:true});
const sdk=spawnSync('xcrun',['--show-sdk-path'],{encoding:'utf8'});
if(sdk.status!==0)throw Error(sdk.stderr||'MAIN_BOOTSTRAP_MACOS_SDK_REQUIRED');
const source=dirname(fileURLToPath(import.meta.url));
function build(executable,args){const result=spawnSync(executable,args,{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr||result.stdout);process.exit(result.status||1);}}
const common=['-Werror','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-I',headers,...installation];
const client=output+'.client.o',wire=output+'.wire.o';
build('cc',[...common,'-std=c11','-c',resolve(source,'installed-main-client.c'),'-o',client]);
build('cc',[...common,'-std=c11','-c',resolve(source,'../main-installation/wire.c'),'-o',wire]);
build('c++',[...common,'-std=c++20','-bundle','-undefined','dynamic_lookup','-DV8_COMPRESS_POINTERS','-DV8_ENABLE_SANDBOX',resolve(source,'main-bootstrap.cc'),client,wire,'-framework','Security','-lbsm','-o',output]);
