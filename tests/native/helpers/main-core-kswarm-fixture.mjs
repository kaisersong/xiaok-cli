// Compile/copy only. This helper never launches Electron or an installation helper.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,readdirSync,readlinkSync,existsSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {prepareMainInstalledFixture} from './main-installed-fixture.mjs';
export const hashCoreFixture=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
export function coreFixtureTree(root){if(!existsSync(root))return null;const rows=[];const walk=file=>{const st=lstatSync(file),row={path:relative(root,file).split('\\').join('/'),mode:st.mode&0o7777};if(st.isSymbolicLink()){row.kind='symlink';row.target=readlinkSync(file);}else if(st.isDirectory())row.kind='directory';else if(st.isFile()){row.kind='file';row.bytes=st.size;row.sha256=hashCoreFixture(file);}else throw Error('fixture_tree_kind');rows.push(row);if(st.isDirectory())for(const name of readdirSync(file).sort())walk(join(file,name));};walk(root);return rows;}
export async function prepareCoreKSwarmFixture(repo,headers,{nativeRepo=repo}={}){
 const sources={},capture=file=>{file=resolve(file);if(sources[file])return;sources[file]=hashCoreFixture(file);if(/\.(?:c|cc|h)$/.test(file))for(const match of readFileSync(file,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const child=resolve(dirname(file),match[1]);if(existsSync(child))capture(child);}};
 for(const directory of ['native/root-resource-authority','native/main-installation','native/kswarm-authority-source'])for(const name of readdirSync(join(nativeRepo,directory))){const file=join(nativeRepo,directory,name);if(/\.(?:c|cc|h|mjs|json)$/.test(name)&&lstatSync(file).isFile())capture(file);}
 for(const name of ['tests/native/fixtures/main-core-kswarm.cjs','tests/native/fixtures/main-core-kswarm-entry.ts','tests/native/helpers/main-core-kswarm-fixture.mjs','tests/native/helpers/main-installed-fixture.mjs','tests/native/helpers/electron-executable.mjs'])capture(join(repo,name));
 const registry=join(homedir(),'.xiaok','profile-sources'),registryBefore=coreFixtureTree(registry);
 const prepared=await prepareMainInstalledFixture(nativeRepo,headers,{authorityFamilies:true}),{root}=prepared,bundle=join(root,'core-kswarm.mjs');
 const built=await createRequire(import.meta.url)('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/main-core-kswarm-entry.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
 for(const file of Object.keys(built.metafile.inputs))if(!file.startsWith('<'))capture(resolve(file));
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 writeFileSync(prepared.entry,`require(${JSON.stringify(join(repo,'tests/native/fixtures/main-core-kswarm.cjs'))})(${JSON.stringify({root,bundle,standalone:prepared.standalone})});\n`);
 const {buildMainProtectedSqliteFixture}=await import(pathToFileURL(join(nativeRepo,'tests/native/helpers/main-protected-sqlite-fixture.mjs')).href);capture(join(nativeRepo,'tests/native/helpers/main-protected-sqlite-fixture.mjs'));
 const facade=buildMainProtectedSqliteFixture(nativeRepo,headers,join(root,'protected_sqlite.node'),prepared.configuration,{electronExecutable:prepared.executable});Object.assign(sources,facade.sources);
 const policySource=join(repo,'tests/native/helpers/application-policy-observer.m'),policy=join(root,'application-policy-observer');capture(policySource);const args=['-fobjc-arc',policySource,'-framework','AppKit','-o',policy],compile=spawnSync('/usr/bin/clang',args,{encoding:'utf8',timeout:15000});writeFileSync(join(root,'core-policy-build.json'),JSON.stringify({pid:compile.pid,args,status:compile.status,signal:compile.signal,stderr:compile.stderr},null,2));assert.equal(compile.error,undefined);assert.equal(compile.status,0,compile.stderr);
 const receiptFile=join(dirname(dirname(dirname(dirname(prepared.executable)))),'receipt.json'),receipt=JSON.parse(readFileSync(receiptFile,'utf8'));assert.ok(receipt.bundleIdentifier.startsWith('org.xiaok.native-test.cache.c'));
 const artifacts=Object.fromEntries([prepared.standalone,prepared.embedded,prepared.helper,prepared.launcher,prepared.configuration,prepared.entry,bundle,policy,receiptFile].map(file=>[file,hashCoreFixture(file)]));Object.assign(artifacts,facade.artifacts);
 for(const [file,sha]of Object.entries({...sources,...artifacts}))assert.equal(hashCoreFixture(file),sha,'source/artifact drift '+file);
 const result={...prepared,sources,artifacts,policy,receipt,receiptFile,registry,registryBefore,mainCount:1,windows:0,productionQualified:false,nativeRepo};writeFileSync(join(root,'core-kswarm-prepared.json'),JSON.stringify(result,null,2)+'\n');return result;
}
