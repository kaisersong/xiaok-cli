import {mkdirSync,copyFileSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {prepareRootNmpLedgerFixture} from './root-nmp-ledger-fixture.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export async function prepareRootNmpCustodyFixture(){
 const p=prepareRootNmpLedgerFixture(),app=join(p.root,'app');symlinkSync(join(repo,'node_modules'),join(p.root,'node_modules'),'dir');mkdirSync(join(app,'native','darwin-universal'),{recursive:true});
 const binary=join(p.root,'native/darwin-universal/root_resource_ledger_source.node');copyFileSync(binary,join(app,'native/darwin-universal/root_resource_ledger_source.node'));
 const before=new Map(),inputs=[];
 const bundle=async(source,output)=>{const result=await build({entryPoints:[join(repo,source)],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:output,external:['better-sqlite3'],metafile:true,define:{'import.meta.url':'__xiaokModuleUrl'},banner:{js:"const __xiaokModuleUrl=require('node:url').pathToFileURL(__filename).href;"},logLevel:'silent'});for(const file of Object.keys(result.metafile.inputs)){const full=resolve(file);const sha=createHash('sha256').update(readFileSync(full)).digest('hex');before.set(full,sha);inputs.push({path:full,sha256:sha});}};
 const entry=join(app,'root-nmp-custody.cjs');await bundle('src/runtime/verification/root-nmp-custody-entry.ts',entry);
 const protocol=join(p.root,'protocol.cjs');await bundle('src/runtime/verification/protocol.ts',protocol);
 const module=join(p.root,'registry.cjs');await bundle('src/runtime/verification/profile-source-custody-registry.ts',module);
 const executable=join(p.root,'component-root-nmp-custody');
 const args=['-std=c11','-Wall','-Wextra','-Werror','-DNR_ROOT_NMP_COMPONENT=1','-DNR_COMPONENT_NODE='+JSON.stringify(process.execPath),'-DNR_COMPONENT_ENTRY='+JSON.stringify(entry),'-DNR_COMPONENT_BIRTH='+JSON.stringify(join(p.root,'component-birth.json')),'-DNR_COMPONENT_CONFIG='+JSON.stringify('XIAOK_CONFIG_DIR='+join(p.root,'config')),join(repo,'tests/native/fixtures/root-nmp-custody-launcher.c'),'-o',executable];
 const c=spawnSync('/usr/bin/cc',args,{encoding:'utf8'});writeFileSync(join(p.root,'component-launcher-build.json'),JSON.stringify({pid:c.pid,status:c.status,signal:c.signal,stderr:c.stderr,args},null,2));if(c.status!==0)throw Error(c.stderr);
 for(const [file,sha]of before)if(createHash('sha256').update(readFileSync(file)).digest('hex')!==sha)throw Error('RootNMP fixture source drift');
 const result={...p,executable,registry:module,protocol,entry,inputs};writeFileSync(join(p.root,'custody-prepared.json'),JSON.stringify(result,null,2));return result;
}
