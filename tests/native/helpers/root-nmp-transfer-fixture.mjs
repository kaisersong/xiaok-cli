import {prepareRootNmpCustodyFixture} from './root-nmp-custody-fixture.mjs';
import {writeFileSync,readFileSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
export async function prepareRootNmpTransferFixture({fault}={}){
 const p=await prepareRootNmpCustodyFixture(),records=[],inputs=[];
 for(const dir of ['native/main-installation','native/root-resource-authority'])for(const name of readdirSync(join(repo,dir)))if(/\.(c|cc|h)$/.test(name)){const path=join(repo,dir,name);inputs.push({path,sha256:sha(path),mtimeNs:String(lstatSync(path,{bigint:true}).mtimeNs)});}
 for(const file of ['src/runtime/verification/root-nmp-custody-entry.ts','tests/native/helpers/root-nmp-transfer-fixture.mjs','tests/native/root-nmp-custody-transfer.test.mjs']){const path=join(repo,file);inputs.push({path,sha256:sha(path),mtimeNs:String(lstatSync(path,{bigint:true}).mtimeNs)});}
 const run=(exe,args)=>{const r=spawnSync(exe,args,{encoding:'utf8'});records.push({pid:r.pid,status:r.status,signal:r.signal,argv:[exe,...args],stderr:r.stderr});writeFileSync(join(p.root,'transfer-builds.json'),JSON.stringify({root:p.root,records,inputs},null,2));assert.equal(r.status,0,r.stderr);return r;};
 const dummy=join(p.root,'not-main'),dummySource=join(p.root,'not-main.c');writeFileSync(dummySource,'int main(void){return 77;}\n');run('/usr/bin/cc',[dummySource,'-o',dummy]);
 const helper=join(p.root,'main-installation-helper'),supervisor=join(p.root,'broker-mainroot-activation-custody'),config=join(p.root,'custody-configuration.h');
 const fixedRoot=join(p.root,'installation-metadata');mkdirSync(fixedRoot,{mode:0o700});
 writeFileSync(config,[`#define MI_FIXED_ROOT ${JSON.stringify(fixedRoot)}`,`#define MI_MAIN_EXEC ${JSON.stringify(dummy)}`,`#define MI_EXPECTED_MAIN_SHA256 ${JSON.stringify(sha(dummy))}`,`#define MI_CUSTODY_NODE ${JSON.stringify(process.execPath)}`,`#define MI_CUSTODY_SOURCE_ENTRY ${JSON.stringify(p.entry)}`,`#define MI_CUSTODY_HELPER_EXEC ${JSON.stringify(helper)}`,`#define MI_CUSTODY_COMPONENT_CONFIG ${JSON.stringify('XIAOK_CONFIG_DIR='+join(p.root,'config'))}`,`#define MI_CUSTODY_COMPONENT_SOURCE_ROOT ${JSON.stringify(p.domain)}`].join('\n')+'\n');
 const common=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',join(repo,'native/main-installation'),'-DMI_CONFIGURATION_HEADER='+JSON.stringify(config)];
 run('/usr/bin/cc',[...common,'-DMI_FIXTURE_BUILD=1','-DMI_CUSTODY_TRANSPORT_COMPONENT=1',...(fault==='helper-close-zero'?['-DMI_CUSTODY_COMPONENT_CLOSE_ZERO=1']:[]),join(repo,'native/main-installation/main-installation-helper.c'),join(repo,'native/main-installation/wire.c'),'-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',helper]);
 run('/usr/bin/cc',[...common,'-DMI_CUSTODY_COMPONENT_BUILD=1',...(fault==='bad-nonce'?['-DMI_CUSTODY_COMPONENT_BAD_NONCE=1']:fault==='wrong-file'?['-DMI_CUSTODY_COMPONENT_WRONG_FILE=1']:[]),join(repo,'native/main-installation/main-root-custody-supervisor.c'),'-framework','Security','-o',supervisor]);
 for(const v of inputs){assert.equal(sha(v.path),v.sha256,'source drift');assert.equal(String(lstatSync(v.path,{bigint:true}).mtimeNs),v.mtimeNs,'source metadata drift');}
 const result={...p,helper,supervisor,fixedRoot,records,inputs};writeFileSync(join(p.root,'transfer-prepared.json'),JSON.stringify(result,null,2));return result;
}
