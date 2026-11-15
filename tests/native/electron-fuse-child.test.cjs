// Real Electron Main + pinned Node IPC regression. This fixture proves runtime
// plumbing and fuse behavior; it never claims original Native Main authority.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'../..'),desktop=path.join(repo,'desktop');
const desktopRequire=createRequire(path.join(desktop,'package.json'));
const supported=['darwin','win32','linux'].includes(process.platform);
test('fused real Electron Main launches fixed Node physical entries and closes actual IPC children',{skip:!supported,timeout:90000},async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.platform==='darwin'?'/tmp':os.tmpdir(),'xf164-fuse-')));
 const mac=process.platform==='darwin';
 const electron=mac?await (await import(pathToFileURL(path.join(repo,'tests/native/helpers/electron-executable.mjs')).href)).getNativeTestElectronExecutable(repo):desktopRequire('electron');
 const source=mac?path.resolve(electron,'../../..'):path.dirname(electron);
 const app=path.join(root,mac?'Fixture.app':'app');
 fs.cpSync(source,app,{recursive:true,verbatimSymlinks:true});
 const resources=path.join(app,mac?'Contents/Resources':'resources');
 const originalExecutable=mac?path.join(app,'Contents/MacOS/Electron'):path.join(app,process.platform==='win32'?'electron.exe':'electron');
 const executable=mac?path.join(app,'Contents/MacOS/Fixture'):path.join(app,process.platform==='win32'?'fixture.exe':'fixture');
 fs.renameSync(originalExecutable,executable);
 if(mac){
  const plist=path.join(app,'Contents/Info.plist');
  const update=spawnSync('plutil',['-replace','CFBundleExecutable','-string','Fixture',plist],{encoding:'utf8'});assert.equal(update.status,0,update.stderr);
 }
 const staging=path.join(root,'source');fs.mkdirSync(staging);
 function write(relative,content){const file=path.join(staging,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
 write('package.json',JSON.stringify({name:'xiaok-fuse-runtime-fixture',version:'1.0.0',type:'module',main:'main.cjs'}));
 write('main.cjs',`const {app}=require('electron');app.setPath('userData',process.argv.find(arg=>arg.startsWith('--profile-dir=')).slice('--profile-dir='.length));process.on('uncaughtException',error=>{console.error(error);app.exit(1);});import('./main.mjs').catch(error=>{console.error(error);app.exit(1);});`);
 const ts=desktopRequire('typescript');
 write('dist/main/src/runtime/node-child-runtime.js',ts.transpileModule(fs.readFileSync(path.join(repo,'src/runtime/node-child-runtime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 for(const name of ['broker-runtime-package.cjs','broker-runtime-file.cjs','node-child-package.cjs'])write('dist/main/desktop/electron/'+name,fs.readFileSync(path.join(desktop,'electron',name)));
 write('dist/main/desktop/resources/broker-runtime-lock.json',fs.readFileSync(path.join(desktop,'resources/broker-runtime-lock.json')));
 write('probe.mjs',`import {DatabaseSync} from 'node:sqlite';import {spawnSync} from 'node:child_process';import {resolveNodeChildRuntime,nodeChildArgs} from './dist/main/src/runtime/node-child-runtime.js';
 const runtime=resolveNodeChildRuntime(process.env,true);const nested=spawnSync(runtime.command,nodeChildArgs(runtime,['--eval','process.stdout.write(process.versions.node)']),{env:runtime.env,encoding:'utf8',timeout:10000});
 const db=new DatabaseSync(':memory:');const sqlite=db.prepare('select sqlite_version() as version').get().version;db.close();
 process.send({node:process.versions.node,sqlite,execPath:process.execPath,resources:process.resourcesPath,nestedNode:nested.stdout,nestedStatus:nested.status,preloadPrefix:runtime.argsPrefix.length,cleanEnv:!['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','XIAOK_NODE_CMD'].some(key=>Object.hasOwn(runtime.env,key))});process.disconnect();`);
 write('main.mjs',`import {app,BrowserWindow} from 'electron';import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {resolveNodeChildRuntime,nodeChildArgs,assertNodeChildRuntimeFilesKnown} from './dist/main/src/runtime/node-child-runtime.js';
 const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);app.setPath('userData',option('--profile-dir'));
 app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadURL('data:text/html,fuse-runtime-fixture');
 const runtime=resolveNodeChildRuntime(process.env,true);const child=spawn(runtime.command,nodeChildArgs(runtime,[fileURLToPath(new URL('./probe.mjs',import.meta.url))]),{env:runtime.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let message,stderr='';child.on('message',value=>message=value);child.stderr.on('data',chunk=>stderr+=String(chunk));child.stdout.resume();
 child.once('error',error=>{console.error(error);app.exit(1);});child.once('close',(code,signal)=>{assertNodeChildRuntimeFilesKnown();writeFileSync(option('--report'),JSON.stringify({isPackaged:app.isPackaged,mainPid:process.pid,childPid:child.pid,code,signal,message,stderr,closed:true}));window.destroy();app.quit();});}).catch(error=>{console.error(error);app.exit(1);});`);
 const asar=desktopRequire('@electron/asar');
 const archive=path.join(resources,'app.asar');fs.rmSync(archive,{force:true});await asar.createPackage(staging,archive);
 const {shipBrokerRuntime}=require('../../desktop/scripts/pack-broker-runtime.cjs');
 shipBrokerRuntime({cacheRoot:path.join(repo,'.artifacts/broker-runtimes'),resources,target:process.platform+'-'+process.arch});
 require('../../desktop/scripts/pack-node-child.cjs').packNodeChild(archive);
 const preload=path.join(root,'preload.cjs'),preloadCanary=path.join(root,'preloaded'),evalCanary=path.join(root,'evaluated'),report=path.join(root,'report.json');
 fs.writeFileSync(preload,'require("node:fs").writeFileSync('+JSON.stringify(preloadCanary)+',"forbidden")');
 const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require='+JSON.stringify(preload),XIAOK_NODE_CMD:path.join(root,'forbidden-node')};
 const args=['--inspect=127.0.0.1:0','--eval','require("node:fs").writeFileSync('+JSON.stringify(evalCanary)+',"forbidden")'];
 if(mac){const sign=spawnSync('codesign',['--force','--sign','-',app],{encoding:'utf8'});assert.equal(sign.status,0,sign.stderr);}
 const control=spawnSync(executable,args,{env,encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(control.status,0,control.stderr);assert(fs.existsSync(preloadCanary));assert(fs.existsSync(evalCanary));assert.match(control.stderr,/Debugger listening/);
 fs.rmSync(preloadCanary);fs.rmSync(evalCanary);
 const wire=await require('../../desktop/scripts/flip-packaged-fuses.cjs').secureElectron(mac?app:executable,mac);
 if(mac)spawnSync('codesign',['--verify','--deep','--strict',app],{encoding:'utf8'}).status===0||assert.fail('fixture signature invalid');
 fs.mkdirSync(path.join(root,'profile'));
 const actual=spawnSync(executable,[...(process.platform==='linux'?['--no-sandbox']:[]),...args,'--profile-dir='+path.join(root,'profile'),'--report='+report],{env,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
 assert(!actual.error,JSON.stringify({root,error:actual.error?.message,stdout:actual.stdout,stderr:actual.stderr}));
 assert.equal(actual.status,0,JSON.stringify({root,error:actual.error?.message,stderr:actual.stderr}));
 assert(!fs.existsSync(preloadCanary));assert(!fs.existsSync(evalCanary));assert.doesNotMatch(actual.stderr,/Debugger listening/);
 const result=JSON.parse(fs.readFileSync(report,'utf8'));assert.equal(result.isPackaged,true);assert.equal(result.closed,true);assert.equal(result.code,0,result.stderr);assert.equal(result.signal,null);
 assert.equal(result.message.node,'24.19.0');assert.equal(result.message.sqlite,'3.53.3');assert.equal(result.message.nestedNode,'24.19.0');assert.equal(result.message.nestedStatus,0);assert.equal(result.message.preloadPrefix,2);assert.equal(result.message.cleanEnv,true);assert.equal(fs.realpathSync(result.message.resources),fs.realpathSync(resources));
 const expected=path.join(resources,'services/intent-broker/runtime',process.platform+'-'+process.arch,process.platform==='win32'?'node.exe':'node');assert.equal(fs.realpathSync(result.message.execPath),fs.realpathSync(expected));
 console.log(JSON.stringify({kind:'real-fused-main-runtime-fixture',wire,node:result.message.node,sqlite:result.message.sqlite,mainClosed:true,ipcChildClosed:true,grandchildClosed:true,canariesExecuted:false,originalNativeMainProof:false,rendererSandboxProof:false}));
 fs.rmSync(root,{recursive:true,maxRetries:3});
});
