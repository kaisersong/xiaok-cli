import {readFileSync,readdirSync,lstatSync,realpathSync,mkdirSync,mkdtempSync,renameSync,rmdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
if(process.platform!=='darwin'){console.log(JSON.stringify({kind:'root-ledger-source-build',platform:process.platform,available:false,productionQualified:false}));process.exit(0);}
const allowed=['--headers','--output'];if(args.length%2||args.some((v,i)=>i%2===0&&!allowed.includes(v))||new Set(args.filter((_,i)=>i%2===0)).size!==args.length/2)throw Error('ROOT_LEDGER_SOURCE_BUILD_ARGUMENT_INVALID');
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:resolve(args[i+1]);};
const headers=option('--headers',resolve(dirname(realpathSync(process.execPath)),'../include/node')),output=option('--output',join(repo,'dist/runtime/verification/native/darwin-universal/root_resource_ledger_source.node'));
const native=join(repo,'native/root-resource-authority'),hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const files=[join(native,'root_resource_authority.c'),join(repo,'native/main-installation/enrollment-custody-channel.h'),...readdirSync(native).filter(name=>name.endsWith('.h')).map(name=>join(native,name)),...['node_api.h','node_api_types.h','js_native_api.h','js_native_api_types.h'].map(name=>join(headers,name))];
const before=files.map(path=>{const stat=lstatSync(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw Error('ROOT_LEDGER_SOURCE_BUILD_INPUT_INVALID');return {path,sha256:hash(path),bytes:String(stat.size),mtimeNs:String(stat.mtimeNs)};});
const records=[];function run(command,argv){const p=spawnSync(command,argv,{encoding:'utf8',timeout:15000});const row={pid:p.pid,command,args:argv,status:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr};records.push(row);if(p.error||p.status!==0||p.signal)throw Error('ROOT_LEDGER_SOURCE_BUILD_FAILED: '+(p.stderr||p.stdout),{cause:p.error});return p.stdout;}
const sdk=run('/usr/bin/xcrun',['--show-sdk-path']).trim();mkdirSync(dirname(output),{recursive:true});
const work=mkdtempSync(join(dirname(output),'.root-ledger-source-build-')),temporary=join(work,'root_resource_ledger_source.node');
try{
 run('/usr/bin/clang',['-std=c11','-mmacosx-version-min=11.0','-Werror','-Wno-deprecated-declarations','-DNAPI_VERSION=8','-DNR_LEDGER_SOURCE_ADDON=1','-isysroot',sdk,'-I',headers,'-arch','arm64','-arch','x86_64','-bundle','-undefined','dynamic_lookup','-ffile-prefix-map='+repo+'=xiaok-cli',join(native,'root_resource_authority.c'),'-lsqlite3','-o',temporary]);
 const architectures=run('/usr/bin/lipo',['-archs',temporary]).trim().split(/\s+/).sort();if(JSON.stringify(architectures)!==JSON.stringify(['arm64','x86_64']))throw Error('ROOT_LEDGER_SOURCE_BUILD_ARCHITECTURES');
 for(const entry of before){const stat=lstatSync(entry.path,{bigint:true});if(String(stat.size)!==entry.bytes||String(stat.mtimeNs)!==entry.mtimeNs||hash(entry.path)!==entry.sha256)throw Error('ROOT_LEDGER_SOURCE_BUILD_INPUT_CHANGED');}
 if(lstatSync(temporary).size<4096)throw Error('ROOT_LEDGER_SOURCE_BUILD_EMPTY');renameSync(temporary,output);rmdirSync(work);
 const receipt={kind:'root-ledger-source-build',napiVersion:8,minimumMacOS:'11.0',architectures,artifactSha256:hash(output),sourceInputs:before,children:records,installed:false,distributionSigned:false,codesignInvoked:false,productionQualified:false};
 console.log(JSON.stringify({...receipt,output}));
}catch(raw){console.error(JSON.stringify({kind:'root-ledger-source-build-failed',sourceInputs:before,children:records,work}));throw raw;}
