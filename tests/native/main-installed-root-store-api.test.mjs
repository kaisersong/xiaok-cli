import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('actual installed RootC entry exists and refuses Node component before filesystem or foreign issuer inspection', {skip:process.platform!=='darwin'||!['127','137'].includes(process.versions.modules)},()=>{
 const root=mkdtempSync(join(tmpdir(),'root-installed-api-'));mkdirSync(join(root,'config'),{mode:0o700});
 process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const native=join(repo,'native/root-resource-authority');
 const headers=process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node');assert.ok(existsSync(join(headers,'node.h')));
 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const common=['-Werror','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-I',headers,'-DMI_FIXTURE_BUILD=1','-DNR_MAIN_INSTALLATION_COMPONENT=1','-DNR_MAIN_BOOTSTRAP_EMBEDDED=1','-DNAPI_VERSION=8'];
 const records=[];const build=(exe,args)=>{const row=spawnSync(exe,args,{encoding:'utf8'});records.push({pid:row.pid,code:row.status,signal:row.signal,stderr:row.stderr});writeFileSync(join(root,'builds.json'),JSON.stringify(records,null,2));assert.equal(row.status,0,row.stderr);};
 const objects=[];
 for(const name of ['root_resource_authority.c','installed-main-client.c','original-root-io-vfs.c','../main-installation/wire.c']){const out=join(root,objects.length+'.o');build('/usr/bin/cc',[...common,'-std=c11','-c',join(native,name),'-o',out]);objects.push(out);}
 const binary=join(root,'original.node');
 build('/usr/bin/c++',[...common,'-std=c++20','-bundle','-undefined','dynamic_lookup',...(process.config.variables.v8_enable_pointer_compression?['-DV8_COMPRESS_POINTERS']:[]),...(process.config.variables.v8_enable_sandbox?['-DV8_ENABLE_SANDBOX']:[]),join(native,'main-bootstrap.cc'),...objects,'-lsqlite3','-framework','Security','-lbsm','-o',binary]);
 const addon=createRequire(import.meta.url)(binary);assert.equal(typeof addon.openOriginalInstalledMainIssuer,'function');
 const missing=['readOriginalMainPoolBootstrap','sealOriginalMainRootBusiness'].filter(name=>typeof addon[name]!=='function');assert.deepEqual(missing,[],'actual original Core lifecycle exports required');
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('unexpected getter');},getOwnPropertyDescriptor(){traps++;throw Error('unexpected descriptor');}});
 assert.throws(()=>addon.openOriginalInstalledMainIssuer(foreign),/ROOT_RESOURCE_MAIN_ROLE_UNAVAILABLE/);for(const name of ['readOriginalMainPoolBootstrap','sealOriginalMainRootBusiness'])assert.throws(()=>addon[name](foreign),/SESSION_REQUIRED/);assert.equal(traps,0);
 console.log(JSON.stringify({kind:'installed-root-store-api',root,gui:0,records,productionQualified:false}));
});
