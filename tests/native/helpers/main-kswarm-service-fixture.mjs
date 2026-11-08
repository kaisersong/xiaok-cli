// Build/copy only. This module never spawns Main, an installed helper or a service.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,chmodSync,symlinkSync,readdirSync,lstatSync,existsSync,realpathSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMainInstalledFixture} from './main-installed-fixture.mjs';
import {buildMainProtectedSqliteFixture} from './main-protected-sqlite-fixture.mjs';
import {coreFixtureTree,hashCoreFixture as hash} from './main-core-kswarm-fixture.mjs';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../..');
async function unusedPort(){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert.ok(address&&typeof address==='object');await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));return address.port;}
function privatePorts(typescript,file,ports){
 const original=readFileSync(file,'utf8'),ast=typescript.createSourceFile(file,original,typescript.ScriptTarget.Latest,true),edits=[];
 function visit(node){if(typescript.isVariableDeclaration(node)&&typescript.isIdentifier(node.name)&&Object.hasOwn(ports,node.name.text)){assert.ok(node.initializer&&typescript.isNumericLiteral(node.initializer));const expected=node.name.text==='KSWARM_PORT'?4400:4318;assert.equal(Number(node.initializer.text),expected);edits.push({start:node.initializer.getStart(ast),end:node.initializer.end,original:original.slice(node.initializer.getStart(ast),node.initializer.end),value:String(ports[node.name.text])});}typescript.forEachChild(node,visit);}visit(ast);assert.equal(edits.length,2);
 let changed=original;for(const edit of [...edits].sort((a,b)=>b.start-a.start))changed=changed.slice(0,edit.start)+edit.value+changed.slice(edit.end);
 // Independent forward reversal from the original edit map, without searching names.
 let check=changed;for(const edit of [...edits].sort((a,b)=>b.start-a.start)){const shift=edits.filter(other=>other.start<edit.start).reduce((n,other)=>n+other.value.length-(other.end-other.start),0);const at=edit.start+shift;check=check.slice(0,at)+edit.original+check.slice(at+edit.value.length);}assert.equal(check,original);
 return {original,changed,edits,inverseExact:true};
}
export async function prepareMainKSwarmServiceFixture({nativeRepo,kswarmRepo,nodeExecutable,headers}){
 nativeRepo=realpathSync(nativeRepo);kswarmRepo=realpathSync(kswarmRepo);nodeExecutable=realpathSync(nodeExecutable);headers=realpathSync(headers);
 const sources={},capture=file=>{file=realpathSync(file);if(sources[file])return;const st=lstatSync(file,{bigint:true});assert.ok(st.isFile());sources[file]={sha256:hash(file),bytes:Number(st.size),mtimeNs:String(st.mtimeNs)};if(/\.(c|cc|h)$/.test(file))for(const match of readFileSync(file,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const candidate=resolve(dirname(file),match[1]);if(existsSync(candidate))capture(candidate);}};
 const tree=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())tree(path);else{assert.ok(entry.isFile());capture(path);}}};
 for(const dir of ['native/root-resource-authority','native/main-installation','native/kswarm-authority-source','native/protected-sqlite-facade'])for(const entry of readdirSync(join(nativeRepo,dir),{withFileTypes:true}))if(entry.isFile()&&/\.(c|cc|h|mjs|cjs|json)$/.test(entry.name))capture(join(nativeRepo,dir,entry.name));
 for(const file of ['main-kswarm-service-fixture.mjs','main-installed-fixture.mjs','main-protected-sqlite-fixture.mjs','electron-executable.mjs','application-policy-observer.m'])capture(join(here,file));
 for(const file of ['main-kswarm-service-entry.ts','main-kswarm-service.cjs'])capture(join(repo,'tests/native/fixtures',file));
 tree(join(kswarmRepo,'src'));capture(join(kswarmRepo,'package.json'));capture(nodeExecutable);
 const registry=join(homedir(),'.xiaok','profile-sources'),registryBefore=coreFixtureTree(registry);
 const prepared=await prepareMainInstalledFixture(nativeRepo,headers,{authorityFamilies:true}),{root}=prepared;
 const kswarm=join(root,'services','kswarm'),runtime=join(kswarm,'runtime');mkdirSync(runtime,{recursive:true});cpSync(join(kswarmRepo,'src'),join(kswarm,'src'),{recursive:true});copyFileSync(join(kswarmRepo,'package.json'),join(kswarm,'package.json'));
 const require=createRequire(join(repo,'desktop/package.json')),ws=dirname(require.resolve('ws/package.json'));tree(ws);mkdirSync(join(kswarm,'node_modules'));cpSync(ws,join(kswarm,'node_modules','ws'),{recursive:true});
 const node=join(root,'node');copyFileSync(nodeExecutable,node,constants.COPYFILE_FICLONE);chmodSync(node,0o500);
 const childLauncher=join(root,'kswarm-child-launcher');
 const additions=[['MI_KSWARM_LAUNCHER_EXEC',childLauncher],['MI_KSWARM_EXEC',node],['MI_KSWARM_ENTRY',join(kswarm,'src/server/original-authority-bootstrap.js')],['MI_EXPECTED_KSWARM_SHA256',hash(node)]];
 writeFileSync(prepared.configuration,readFileSync(prepared.configuration,'utf8')+additions.map(([key,value])=>'#define '+key+' '+JSON.stringify(value)+'\n').join('')+'#define NR_MAIN_DSH_SERVICE_COMPONENT 1\n');
 const builds=[],build=(command,args)=>{const out=spawnSync(command,args,{cwd:nativeRepo,encoding:'utf8'});builds.push({command,args,pid:out.pid,status:out.status,signal:out.signal,stdout:out.stdout,stderr:out.stderr});writeFileSync(join(root,'main-service-builds.json'),JSON.stringify(builds,null,2));assert.equal(out.error,undefined);assert.equal(out.status,0,out.stderr||out.stdout);};
 build(process.execPath,[join(nativeRepo,'native/root-resource-authority/build-main-bootstrap.mjs'),headers,prepared.standalone,prepared.configuration]);
 build(process.execPath,[join(nativeRepo,'native/root-resource-authority/build-main-session.mjs'),headers,prepared.embedded,prepared.nativeRoot,'embedded','-',prepared.configuration]);
 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const native=join(nativeRepo,'native/root-resource-authority'),wire=join(nativeRepo,'native/main-installation'),ks=join(nativeRepo,'native/kswarm-authority-source'),facade=join(nativeRepo,'native/protected-sqlite-facade');
 const flags=['-std=c11','-Werror','-Wall','-Wextra','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-I',headers,'-I',native,'-I',wire,'-I',ks,'-I',facade,'-DNAPI_VERSION=8','-DMI_FIXTURE_BUILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(prepared.configuration)];
 const frameworks=['-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm'];
 for(const [file,out]of [[join(wire,'main-installation-entry.c'),prepared.launcher],[join(wire,'main-installation-helper.c'),prepared.helper],[join(ks,'kswarm-child-launcher.c'),childLauncher]])build('/usr/bin/cc',[...flags,file,join(wire,'wire.c'),...frameworks,'-o',out]);
 build('/usr/bin/cc',[...flags,'-bundle','-undefined','dynamic_lookup',join(ks,'kswarm-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c'),'-lsqlite3',...frameworks,'-o',join(runtime,'protected_sqlite.node')]);
 copyFileSync(join(facade,'index.cjs'),join(runtime,'index.cjs'));copyFileSync(join(ks,'original-authority-sqlite.cjs'),join(runtime,'original-authority-sqlite.cjs'));
 build(process.execPath,[join(repo,'native/sidecar-source-runtime/build.mjs'),join(runtime,'xiaok-source-runtime.cjs')]);
 build(process.execPath,[join(repo,'native/sidecar-source-runtime/package-dependencies.mjs'),runtime,dirname(require.resolve('better-sqlite3/package.json'))]);
 build(node,['-e',"const p=require('node:path'),D=require(p.join(process.argv[1],'node_modules/better-sqlite3'));const db=new D(':memory:');if(db.prepare('select 1 n').get().n!==1)throw Error('actual target dependency failure');db.close();console.log(JSON.stringify({node:process.versions.node,actualTargetDependencyQuery:true}));",runtime]);
 const kswarmPort=await unusedPort();let brokerPort=await unusedPort();while(brokerPort===kswarmPort)brokerPort=await unusedPort();
 const serviceFile=join(repo,'desktop/electron/kswarm-service.ts');capture(serviceFile);const projected=privatePorts(require('typescript'),serviceFile,{KSWARM_PORT:kswarmPort,BROKER_PORT:brokerPort});writeFileSync(join(root,'service-private-port-projection.json'),JSON.stringify({source:serviceFile,sourceSHA:hash(serviceFile),edits:projected.edits,inverseExact:projected.inverseExact,kswarmPort,brokerPort},null,2));
 const bundle=join(root,'main-service.mjs');const graph=await require('esbuild').build({absWorkingDir:repo,entryPoints:[join(repo,'tests/native/fixtures/main-kswarm-service-entry.ts')],outdir:root,entryNames:'main-service',chunkNames:'main-service-[hash]',outExtension:{'.js':'.mjs'},bundle:true,splitting:true,platform:'node',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"},plugins:[{name:'only-two-private-service-ports',setup(build){build.onLoad({filter:/kswarm-service\.ts$/},args=>args.path===serviceFile?{contents:projected.changed,loader:'ts'}:undefined);}}]});for(const file of Object.keys(graph.metafile.inputs))if(!file.startsWith('<'))capture(resolve(repo,file));
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 writeFileSync(prepared.entry,`require(${JSON.stringify(join(repo,'tests/native/fixtures/main-kswarm-service.cjs'))})(${JSON.stringify({root,bundle,standalone:prepared.standalone,kswarm,kswarmPort,brokerPort})});\n`);
 const protectedSqlite=buildMainProtectedSqliteFixture(nativeRepo,headers,join(root,'protected_sqlite.node'),prepared.configuration,{electronExecutable:prepared.executable});for(const file of Object.keys(protectedSqlite.sources))capture(file);
 const policy=join(root,'application-policy-observer');build('/usr/bin/clang',['-fobjc-arc',join(here,'application-policy-observer.m'),'-framework','AppKit','-o',policy]);
 const receiptFile=join(dirname(dirname(dirname(dirname(prepared.executable)))),'receipt.json'),receipt=JSON.parse(readFileSync(receiptFile,'utf8'));assert.ok(receipt.bundleIdentifier.startsWith('org.xiaok.native-test.cache.c'));
 const artifacts={};const artifactTree=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())artifactTree(file);else if(entry.isFile())artifacts[file]=hash(file);}};artifactTree(root);artifacts[receiptFile]=hash(receiptFile);
 for(const [file,before]of Object.entries(sources)){assert.equal(hash(file),before.sha256,'source drift '+file);assert.equal(String(lstatSync(file,{bigint:true}).mtimeNs),before.mtimeNs,'source mtime drift '+file);}
 assert.deepEqual(coreFixtureTree(registry),registryBefore);
 const result={...prepared,repo,nativeRepo,kswarmRepo,sources,artifacts,bundle,kswarm,kswarmPort,brokerPort,policy,receipt,receiptFile,registry,registryBefore,mainArgv:[prepared.executable,prepared.entry],helperArgv:[prepared.helper],configDir:join(root,'config'),buildOnly:true,mainLaunches:0,helperLaunches:0,windows:0,qualification:false};writeFileSync(join(root,'main-service-prepared.json'),JSON.stringify(result,null,2)+'\n');return result;
}

/** Rebundle a failed pre-Native parse attempt without copying another App or
 * resetting any namespace/DB. The original manifest/001 evidence stays sealed. */
export async function rebundleMainKSwarmServiceFixture(previous){
 const root=previous.root,require=createRequire(join(repo,'desktop/package.json'));
 const projection=JSON.parse(readFileSync(join(root,'service-private-port-projection.json'),'utf8'));
 const serviceFile=join(repo,'desktop/electron/kswarm-service.ts');assert.equal(hash(serviceFile),projection.sourceSHA);
 const patched=privatePorts(require('typescript'),serviceFile,{KSWARM_PORT:projection.kswarmPort,BROKER_PORT:projection.brokerPort});
 const before={...previous.sources},helper=join(here,'main-kswarm-service-fixture.mjs');
 for(const [file,expected]of Object.entries(before))if(file!==helper){assert.equal(hash(file),expected.sha256,'prior source drift '+file);assert.equal(String(lstatSync(file,{bigint:true}).mtimeNs),expected.mtimeNs);}
 for(const [file,expected]of Object.entries(previous.artifacts))assert.equal(hash(file),expected,'prior artifact drift '+file);
 const revision='attempt002',entryName='main-service-'+revision;
 const graph=await require('esbuild').build({absWorkingDir:repo,entryPoints:[join(repo,'tests/native/fixtures/main-kswarm-service-entry.ts')],outdir:root,entryNames:entryName,chunkNames:'main-service-attempt002-[hash]',outExtension:{'.js':'.mjs'},bundle:true,splitting:true,platform:'node',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"},plugins:[{name:'only-two-private-service-ports',setup(build){build.onLoad({filter:/kswarm-service\.ts$/},args=>args.path===serviceFile?{contents:patched.changed,loader:'ts'}:undefined);}}]});
 const checks=[],generated=Object.keys(graph.metafile.outputs).filter(file=>file.endsWith('.mjs')).map(file=>resolve(repo,file)),ts=require('typescript');
 for(const file of generated){
  const text=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(ast.parseDiagnostics.length,0,'generated AST parse failure '+file);
  const lexical=[];for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name))lexical.push({name:declaration.name.text,line:ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line+1});
  for(const executable of [process.execPath,join(root,'node')]){const out=spawnSync(executable,['--check',file],{encoding:'utf8'});checks.push({file,sha256:hash(file),executable,pid:out.pid,status:out.status,signal:out.signal,stdout:out.stdout,stderr:out.stderr,astParseDiagnostics:ast.parseDiagnostics.length,topLevelBindings:lexical});assert.equal(out.error,undefined);assert.equal(out.status,0,out.stderr);}
 }
 writeFileSync(join(root,'attempt002-generated-checks.json'),JSON.stringify(checks,null,2)+'\n');
 // The launcher has one fixed compiled entry path. Archive its exact old bytes
 // before changing only this fixture's bundle pointer; no Native bytes change.
 const entryBackup=join(root,'entry-attempt001.cjs');assert.equal(existsSync(entryBackup),false);copyFileSync(previous.entry,entryBackup);
 const bundle=join(root,entryName+'.mjs');writeFileSync(previous.entry,`require(${JSON.stringify(join(repo,'tests/native/fixtures/main-kswarm-service.cjs'))})(${JSON.stringify({root,bundle,standalone:previous.standalone,kswarm:previous.kswarm,kswarmPort:previous.kswarmPort,brokerPort:previous.brokerPort})});\n`);
 const sources={...before};for(const file of [helper,...Object.keys(graph.metafile.inputs).filter(file=>!file.startsWith('<')).map(file=>resolve(repo,file))]){const st=lstatSync(file,{bigint:true});sources[file]={sha256:hash(file),bytes:Number(st.size),mtimeNs:String(st.mtimeNs)};}
 const artifacts={...previous.artifacts,[previous.entry]:hash(previous.entry),[entryBackup]:hash(entryBackup),[join(root,'attempt002-generated-checks.json')]:hash(join(root,'attempt002-generated-checks.json'))};for(const file of generated)artifacts[file]=hash(file);
 const result={...previous,sources,artifacts,bundle,revision,originalManifest:join(root,'main-service-prepared.json'),originalManifestSHA256:hash(join(root,'main-service-prepared.json')),generatedChecks:join(root,'attempt002-generated-checks.json'),namespaceReset:false,appCopyCount:1,mainLaunches:0,helperLaunches:0};
 const output=join(root,'main-service-prepared-attempt002.json');assert.equal(existsSync(output),false);writeFileSync(output,JSON.stringify(result,null,2)+'\n');return {manifest:output,prepared:result};
}
