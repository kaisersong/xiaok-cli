import {populateBrokerRuntimeFixture} from '../fixtures/broker-runtime-fixture.js';
import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,linkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolvePackagedBrokerRuntime,brokerRuntimeMatchesHealth} from '../../electron/broker-node-runtime.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(platform:'darwin'|'win32'){
 const root=mkdtempSync(join(tmpdir(),'broker-runtime-'));roots.push(root);
 const target=platform==='darwin'?'darwin-arm64':'win32-x64',dir=join(root,'services','intent-broker','runtime',target);
 mkdirSync(dir,{recursive:true});const official=populateBrokerRuntimeFixture(dir,target);
 return {root,dir,command:official.command,manifest:official.manifest,restoreBinary:official.restoreBinary};
}
describe('pinned ordinary broker Node runtime',()=>{
 it.skipIf(!['darwin-arm64','win32-x64'].includes(process.platform+'-'+process.arch))('runs the production SQLite facade on the actual pinned child runtime',()=>{
  const f=fixture(process.platform==='win32'?'win32':'darwin'),database=join(f.root,'history.sqlite');
  const facade=pathToFileURL(resolve(__dirname,'../../../src/utils/builtin-sqlite.ts')).href;
  const program=`
    import assert from 'node:assert/strict';
    import Database from ${JSON.stringify(facade)};
    const path=${JSON.stringify(database)};
    let db=new Database(path);
    const sqlite=db.prepare('select sqlite_version() as v').get().v;
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE history(id INTEGER PRIMARY KEY,text TEXT,bytes BLOB)');
    db.prepare('INSERT INTO history VALUES(?,?,?)').run(1,'saved history',Buffer.from([0,255]));
    assert.throws(()=>db.transaction(()=>{db.prepare('INSERT INTO history VALUES(?,?,?)').run(2,'rolled back',null);throw Error('rollback');}).immediate(),/rollback/);
    db.transaction(()=>{
      db.prepare('INSERT INTO history VALUES(?,?,?)').run(3,'outer commit',null);
      assert.throws(()=>db.transaction(()=>{db.prepare('INSERT INTO history VALUES(?,?,?)').run(2,'nested rollback',null);throw Error('nested rollback');})(),/nested rollback/);
    })();
    assert.deepEqual(db.prepare('SELECT id FROM history ORDER BY id').pluck().all(),[1,3]);
    assert.equal(db.inTransaction,false);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
    db=new Database(path,{readonly:true,fileMustExist:true});
    assert.deepEqual(db.prepare('SELECT * FROM history ORDER BY id').all(),[{id:1,text:'saved history',bytes:Buffer.from([0,255])},{id:3,text:'outer commit',bytes:null}]);
    assert.throws(()=>db.prepare('DELETE FROM history').run(),/readonly|read.only/i);db.close();
    console.log(JSON.stringify({node:process.versions.node,sqlite,rows:2,rollback:true,readonly:true}));
  `;
  const result=spawnSync(f.command,['--experimental-strip-types','--input-type=module','-e',program],{encoding:'utf8',timeout:10_000,windowsHide:true});
  expect(result.error).toBeUndefined();expect(result.signal).toBeNull();expect(result.status,result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({node:f.manifest.node,sqlite:f.manifest.sqlite,rows:2,rollback:true,readonly:true});
 });
 it.skipIf(!['darwin-arm64','win32-x64'].includes(process.platform+'-'+process.arch))('keeps real packaged-runtime HTTP requests alive when optional socket QoS throws',()=>{
  const f=fixture(process.platform==='win32'?'win32':'darwin');
  const program=`
    const http=require('node:http'),net=require('node:net');
    let attempts=0,requests=0;
    net.Socket.prototype.setTypeOfService=function(){attempts++;throw Object.assign(Error('fixture QoS failure'),{code:'EINVAL',syscall:'setTypeOfService'});};
    const server=http.createServer((req,res)=>{requests++;res.end('ok');});
    server.listen(0,'127.0.0.1',async()=>{try{
      const url='http://127.0.0.1:'+server.address().port+'/';
      const first=await fetch(url);if(first.status!==200||await first.text()!=='ok'||attempts!==0)throw Error('default_fetch_qos_regression');
      const dispatcher=globalThis[Symbol.for('undici.globalDispatcher.1')];
      if(!dispatcher||typeof dispatcher.dispatch!=='function')throw Error('actual_builtin_dispatcher_missing');
      const explicit={dispatch(options,handler){return dispatcher.dispatch({...options,typeOfService:16},handler);}};
      const second=await fetch(url,{dispatcher:explicit});
      if(second.status!==200||await second.text()!=='ok'||attempts<1||requests!==2)throw Error('explicit_qos_not_caught');
      console.log(JSON.stringify({node:process.versions.node,undici:process.versions.undici,requests,attempts}));
    }catch(error){console.error(error);process.exitCode=1;}finally{server.closeAllConnections();server.close();}});
  `;
  const result=spawnSync(f.command,['-e',program],{encoding:'utf8',timeout:10_000,windowsHide:true});
  expect(result.error).toBeUndefined();expect(result.signal).toBeNull();
  expect(result.status,result.stderr).toBe(0);
  // Intentional coupling: a future Node pin must reverify its bundled QoS fix.
  expect(JSON.parse(result.stdout)).toMatchObject({node:f.manifest.node,undici:'7.30.2',requests:2});
 });
 for(const platform of ['darwin','win32'] as const)it('uses manifest-verified package executable on '+platform+' and ignores environment executable/Node injection',()=>{
  const f=fixture(platform),runtime=resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:f.root,platform,arch:platform==='darwin'?'arm64':'x64',env:{XIAOK_NODE_CMD:'/untrusted',NODE_OPTIONS:'--require=/bad',NODE_PATH:'/bad',ELECTRON_RUN_AS_NODE:'1',KEEP:'yes'}})!;
  expect(runtime.command).toBe(realpathSync(f.command));expect(runtime.env.KEEP).toBe('yes');
  for(const key of ['XIAOK_NODE_CMD','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])expect(runtime.env[key]).toBeUndefined();
  expect(brokerRuntimeMatchesHealth({service:{runtime:{node:'24.22.3',sqlite:'3.54.1',execPath:realpathSync(f.command),executableSha256:f.manifest.executableSha256}}},runtime)).toBe(true);
  expect(brokerRuntimeMatchesHealth({service:{runtime:{node:'22.22.1',sqlite:'3.51.2',execPath:realpathSync(f.command),executableSha256:f.manifest.executableSha256}}},runtime)).toBe(false);
 });
 it('scrubs every Windows case variant and duplicate without changing the caller environment',()=>{
  const f=fixture('win32'),env=Object.freeze({NODE_OPTIONS:'--require=/upper',Node_Options:'--require=/mixed',node_options:'--require=/lower',Node_Path:'/untrusted',eLeCtRoN_rUn_As_NoDe:'1',Xiaok_Node_Cmd:'/untrusted',KEEP:'yes',NODE_OPTIONS_HINT:'keep'});
  const runtime=resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:f.root,platform:'win32',arch:'x64',env})!;
  const blocked=['XIAOK_NODE_CMD','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'];
  expect(Object.keys(runtime.env).filter(key=>blocked.includes(key.toUpperCase()))).toEqual([]);
  expect(runtime.command).toBe(realpathSync(f.command));expect(runtime.env.KEEP).toBe('yes');expect(runtime.env.NODE_OPTIONS_HINT).toBe('keep');
  expect(env).toEqual({NODE_OPTIONS:'--require=/upper',Node_Options:'--require=/mixed',node_options:'--require=/lower',Node_Path:'/untrusted',eLeCtRoN_rUn_As_NoDe:'1',Xiaok_Node_Cmd:'/untrusted',KEEP:'yes',NODE_OPTIONS_HINT:'keep'});
 });
 it('preserves an environment containing only unrelated variables',()=>{
  const f=fixture('darwin'),env=Object.freeze({KEEP:'yes',PATH:'/system',NODE_OPTIONS_HINT:'not a runtime selector'});
  expect(resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:f.root,platform:'darwin',arch:'arm64',env})!.env).toEqual(env);
 });
 it('development and targets outside the pinned compatibility profiles leave the existing resolver in control',()=>{
  expect(resolvePackagedBrokerRuntime({isPackaged:false,resourcesPath:'/unused',env:{}})).toBeNull();
  expect(resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:'/unused',platform:'freebsd',arch:'x64',env:{}})).toBeNull();
  // Linux is now a pinned fuse-migration target; the original input must fail
  // closed on its missing package instead of selecting the legacy executable.
  for(const arch of ['x64','arm64']){
   try{resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:'/unused',platform:'linux',arch,env:{}});throw Error('missing package accepted');}
   catch(error){expect(error).toMatchObject({code:'ENOENT'});expect(String((error as NodeJS.ErrnoException).path).replaceAll('\\','/')).toMatch(/\/unused$/);}
  }
 });
 it('missing runtime fails closed, with no environment fallback',()=>{
  const root=mkdtempSync(join(tmpdir(),'broker-runtime-missing-'));roots.push(root);
  expect(()=>resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:root,platform:'win32',arch:'x64',env:{XIAOK_NODE_CMD:'node'}})).toThrow();
 });
 it('changed binary, changed provenance and aliased binary are rejected',()=>{
  const f=fixture('darwin'),input={isPackaged:true,resourcesPath:f.root,platform:'darwin' as const,arch:'arm64',env:{}};
  resolvePackagedBrokerRuntime(input);writeFileSync(f.command,'tampered');
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
  f.restoreBinary();f.manifest.archiveSha256='0'.repeat(64);writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
  f.manifest.archiveSha256='8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d';writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
  const real=join(f.root,'elsewhere');writeFileSync(real,'qualified fixture executable');rmSync(f.command);if(process.platform==='win32')linkSync(real,f.command);else symlinkSync(real,f.command);
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
 });
});
