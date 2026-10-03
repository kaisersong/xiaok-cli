import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

// Test the exact npm runtime. Only its OS helper process is injected on macOS.
const packageRoot=process.env.XIAOK_TEST_RELEASE_ROOT;
if(!packageRoot)throw Error('Set XIAOK_TEST_RELEASE_ROOT to the extracted 1.5.7 release');
const originalPlatform=process.platform, originalArch=process.arch, originalSpawn=cp.spawnSync;
let response={version:1,kind:'ordinary'}, invocations=[];
Object.defineProperty(process,'platform',{value:'win32',configurable:true});
Object.defineProperty(process,'arch',{value:'x64',configurable:true});
cp.spawnSync=(file,args,options)=>{
  invocations.push({file,args,options});
  return {status:0,signal:null,stdout:JSON.stringify(response),stderr:''};
};
syncBuiltinESMExports();
const {FileSessionStore}=await import(pathToFileURL(join(packageRoot,'dist/ai/runtime/session-store/file-store.js')));
const {readWindowsInstallationAbsence}=await import(pathToFileURL(join(packageRoot,'dist/runtime/verification/windows-installation-absence.js')));
const {reportCrash,setCrashContext}=await import(pathToFileURL(join(packageRoot,'dist/utils/crash-reporter.js')));
const native=join(packageRoot,'dist/runtime/verification/native/win32-x64');
const manifestPath=join(native,'windows-installation-absence.json');

test.after(()=>{
  Object.defineProperty(process,'platform',{value:originalPlatform,configurable:true});
  Object.defineProperty(process,'arch',{value:originalArch,configurable:true});
  cp.spawnSync=originalSpawn;syncBuiltinESMExports();
});

for(const kind of ['installed','unavailable'])test(`real FileSessionStore refuses ${kind} and creates no snapshot`,async()=>{
  response={version:1,kind};
  const root=fs.mkdtempSync(join(tmpdir(),'xiaok-win-deny-'));
  try {
    const store=new FileSessionStore(root);
    await assert.rejects(store.save(snapshot()),/ordinary_source_route/);
    assert.deepEqual(fs.readdirSync(root),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('real FileSessionStore saves first K3 session, saves next turn and restores last session',async()=>{
  response={version:1,kind:'ordinary'};invocations=[];
  const root=fs.mkdtempSync(join(tmpdir(),'xiaok-win-save-'));
  try {
    const store=new FileSessionStore(root);
    await store.save(snapshot());
    const first=await store.loadLast();assert.equal(first.sessionId,'sess_windows_test');
    first.messages.push({role:'user',content:[{type:'text',text:'test'}]});
    await store.save({...first,updatedAt:2});
    const resumed=await new FileSessionStore(root).loadLast();
    assert.equal(resumed.messages.length,1);
    assert.equal(resumed.model,'k3');
    assert.ok(invocations.length>=2);
    for(const call of invocations){
      assert.equal(call.file,join(native,'windows-installation-absence.exe'));
      assert.deepEqual(call.args,[]);assert.deepEqual(call.options.env,{});
      assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('missing manifest reproduces the original save failure and never starts a process',async()=>{
  const bytes=fs.readFileSync(manifestPath);response={version:1,kind:'ordinary'};invocations=[];
  const root=fs.mkdtempSync(join(tmpdir(),'xiaok-win-missing-'));
  try{
    fs.unlinkSync(manifestPath);
    assert.equal(readWindowsInstallationAbsence(),'unavailable');
    await assert.rejects(new FileSessionStore(root).save(snapshot()),/ordinary_source_route/);
    assert.equal(invocations.length,0);assert.deepEqual(fs.readdirSync(root),[]);
    const previousConfig=process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR=root;
    try{
      setCrashContext({command:'chat',startupPhase:'agent'});
      try{await new FileSessionStore(root).save(snapshot());}catch(error){
        const report=JSON.parse(fs.readFileSync(await reportCrash(error),'utf8'));
        assert.equal(report.version,'1.5.7');assert.equal(report.error.code,'ordinary_source_route');
        assert.ok(report.error.frames.some(frame=>frame.module==='ai/runtime/session-store/file-store.js'));
      }
    }finally{if(previousConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previousConfig;}
  }finally{fs.writeFileSync(manifestPath,bytes);fs.rmSync(root,{recursive:true,force:true});}
});

test('tampered helper is rejected before execution',()=>{
  const file=join(native,'windows-installation-absence.exe'),bytes=fs.readFileSync(file);invocations=[];
  try{fs.writeFileSync(file,Buffer.from('tampered'));assert.equal(readWindowsInstallationAbsence(),'unavailable');assert.equal(invocations.length,0);}
  finally{fs.writeFileSync(file,bytes);}
});

test('helper replacement during query is rejected by the actual reader',()=>{
  const bytes=fs.readFileSync(manifestPath),previous=cp.spawnSync;
  try{
    cp.spawnSync=()=>{fs.writeFileSync(manifestPath,'{}');return {status:0,signal:null,stdout:'{"version":1,"kind":"ordinary"}'};};syncBuiltinESMExports();
    assert.equal(readWindowsInstallationAbsence(),'unavailable');
  }finally{fs.writeFileSync(manifestPath,bytes);cp.spawnSync=previous;syncBuiltinESMExports();}
});

test('malformed, timeout and argument override results never qualify as ordinary',()=>{
  const previous=cp.spawnSync;
  try{
    assert.equal(readWindowsInstallationAbsence('ignored'),'unavailable');
    for(const result of [{status:0,signal:null,stdout:'garbage'},{status:null,signal:'SIGTERM',stdout:''},{status:0,signal:null,stdout:'{"version":1,"kind":"ordinary","path":"spoofed"}'}]){
      cp.spawnSync=()=>result;syncBuiltinESMExports();assert.equal(readWindowsInstallationAbsence(),'unavailable');
    }
  }finally{cp.spawnSync=previous;syncBuiltinESMExports();}
});
function snapshot(){return {sessionId:'sess_windows_test',cwd:process.cwd(),model:'k3',createdAt:1,updatedAt:1,messages:[],usage:{inputTokens:0,outputTokens:0}};}
