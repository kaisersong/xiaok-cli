import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

export function prepareRootNmpLedgerFixture({smallLimit=false,rootIoConfiguration=null}={}){
 const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'root-nmp-ledger-'))),domain=join(root,'domain');mkdirSync(domain,{mode:0o700});mkdirSync(join(root,'config'),{mode:0o700});
 const headers=process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node');
 const version=readFileSync(join(headers,'node_version.h'),'utf8');
 assert.equal(Number(version.match(/^#define NODE_MODULE_VERSION\s+(\d+)/m)?.[1]),Number(process.versions.modules),'actual target Node ABI headers required');
 const native=join(repo,'native/root-resource-authority'),sources=['root_resource_authority.c','main-bootstrap.cc','installed-main-client.c','original-root-io-vfs.c','../main-installation/wire.c'];
 const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');const tracked=[...sources,'../../src/runtime/verification/original-root-nmp-ledger.ts','../../src/runtime/verification/original-main-native-loader.ts','../../src/runtime/verification/original-root-ledger-source-loader.ts',...readdirSync(native).filter(file=>file.endsWith('.h')),...readdirSync(join(native,'../main-installation')).filter(file=>file.endsWith('.h')).map(file=>'../main-installation/'+file)];
 const before=Object.fromEntries(tracked.map(file=>[file,sha(join(native,file))]));
 const records=[];
 function build(exe,args){const result=spawnSync(exe,args,{encoding:'utf8'});records.push({pid:result.pid,argv:[exe,...args],status:result.status,signal:result.signal});writeFileSync(join(root,'builds.json'),JSON.stringify(records,null,2));assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr||result.stdout);return result;}
 const sdk=build('/usr/bin/xcrun',['--show-sdk-path']).stdout.trim();
 const common=['-Werror','-Wno-deprecated-declarations','-isysroot',sdk,'-I',headers,'-DNAPI_VERSION=8','-DNR_MAIN_BOOTSTRAP_EMBEDDED=1','-DNR_FIXTURE_BUILD=1','-DNR_FIXTURE_ROOT='+JSON.stringify(domain),'-DMI_FIXTURE_BUILD=1','-DNR_MAIN_INSTALLATION_COMPONENT=1'];
 const facts=join(root,'facts.h');
 const metadata=[],executionKeys=[];
 for(let i=0;i<8;i++){
  // Closed golden Source-v2 bytes: no caller verifier or Main role. The finite
  // original fixtureSubject is data-only; actual enqueue/claim SQL is native.
  const subject={kind:'room_turn',logicalAgentId:'agent',messageId:'message-'+i,roomId:'room',turnId:'turn-'+i};
  const scope={principalId:'principal',profileId:'profile',workspaceId:'workspace'};
  const key='nr2:'+createHash('sha256').update(JSON.stringify(['root-execution-key-v2',{hostId:'host',scope,subject}])).digest('hex');
  executionKeys.push(key);metadata.push(JSON.stringify({authorizationRef:'authorization',executionClass:'room_discussion',executionKey:key,hostId:'host',payloadHash:'a'.repeat(64),priorityClass:'background',schemaVersion:2,scope,subject}));
 }
 writeFileSync(facts,'static const char *nr_fixture_metadata[]={'+metadata.map(JSON.stringify).join(',')+'};\nstatic const char *nr_fixture_execution_keys[]={'+executionKeys.map(JSON.stringify).join(',')+'};\nstatic const int nr_fixture_priorities[]={0,0,0,0,0,0,0,0};\n#define NR_FIXTURE_FACT_COUNT 8\n');
 common.push('-DNR_FIXTURE_FACTS_HEADER='+JSON.stringify(facts));
 if(rootIoConfiguration!==null)common.push('-DNR_ROOT_IO_COMPONENT=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(rootIoConfiguration));
 if(smallLimit)common.push('-DNR_FIXTURE_LEDGER_SMALL_LIMIT=1');
 const objects=[];
 for(const file of sources.filter(file=>file.endsWith('.c'))){const output=join(root,objects.length+'.o');build('/usr/bin/cc',[...common,'-std=c11','-c',join(native,file),'-o',output]);objects.push(output);}
 const binary=join(root,'root_resource_authority_main.node');
 build('/usr/bin/c++',[...common,'-std=c++20','-bundle','-undefined','dynamic_lookup',...(process.config.variables.v8_enable_pointer_compression?['-DV8_COMPRESS_POINTERS']:[]),...(process.config.variables.v8_enable_sandbox?['-DV8_ENABLE_SANDBOX']:[]),join(native,'main-bootstrap.cc'),...objects,'-lsqlite3','-framework','Security','-lbsm','-o',binary]);
 const coldDirectory=join(root,'native','darwin-universal');mkdirSync(coldDirectory,{recursive:true});
 build('/usr/bin/cc',['-Werror','-Wno-deprecated-declarations','-std=c11','-isysroot',sdk,'-I',headers,'-DNAPI_VERSION=8','-DNR_LEDGER_SOURCE_ADDON=1','-DNR_FIXTURE_BUILD=1','-DNR_FIXTURE_ROOT='+JSON.stringify(domain),'-bundle','-undefined','dynamic_lookup',join(native,'root_resource_authority.c'),'-lsqlite3','-o',join(coldDirectory,'root_resource_ledger_source.node')]);
 for(const [file,digest]of Object.entries(before))assert.equal(sha(join(native,file)),digest,'Native source drift during compile');
 const ts=createRequire(import.meta.url)('typescript');
 for(const name of ['original-root-nmp-ledger','original-main-native-loader','original-root-ledger-source-loader']){
  const source=readFileSync(join(repo,'src/runtime/verification',name+'.ts'),'utf8');
  writeFileSync(join(root,name+'.js'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 const prepared={root,domain,binary,reader:join(root,'original-root-nmp-ledger.js'),typescript:ts.version,records,sources:before,artifactSha256:sha(binary),factsSha256:sha(facts),productionQualified:false,gui:0};writeFileSync(join(root,'prepared.json'),JSON.stringify(prepared,null,2));return prepared;
}
