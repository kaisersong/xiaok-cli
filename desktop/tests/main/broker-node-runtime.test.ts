import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,linkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {resolvePackagedBrokerRuntime,brokerRuntimeMatchesHealth} from '../../electron/broker-node-runtime.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(platform:'darwin'|'win32'){
 const root=mkdtempSync(join(tmpdir(),'broker-runtime-'));roots.push(root);
 const target=platform==='darwin'?'darwin-arm64':'win32-x64',dir=join(root,'services','intent-broker','runtime',target);
 mkdirSync(dir,{recursive:true});const name=platform==='darwin'?'node':'node.exe',command=join(dir,name),bytes=Buffer.from('qualified fixture executable');
 writeFileSync(command,bytes);const sha=createHash('sha256').update(bytes).digest('hex');
 const archiveSha256=platform==='darwin'?'8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d':'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
 const manifest={schema:'xiaok-broker-runtime/v1',node:'24.19.0',sqlite:'3.53.3',target,executable:name,executableSha256:sha,archiveSha256};
 writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));return {root,dir,command,manifest};
}
describe('trusted broker Node runtime',()=>{
 for(const platform of ['darwin','win32'] as const)it('uses manifest-verified package executable on '+platform+' and ignores environment executable/Node injection',()=>{
  const f=fixture(platform),runtime=resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:f.root,platform,arch:platform==='darwin'?'arm64':'x64',env:{XIAOK_NODE_CMD:'/untrusted',NODE_OPTIONS:'--require=/bad',NODE_PATH:'/bad',ELECTRON_RUN_AS_NODE:'1',KEEP:'yes'}})!;
  expect(runtime.command).toBe(realpathSync(f.command));expect(runtime.env.KEEP).toBe('yes');
  for(const key of ['XIAOK_NODE_CMD','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])expect(runtime.env[key]).toBeUndefined();
  expect(brokerRuntimeMatchesHealth({service:{runtime:{node:'24.19.0',sqlite:'3.53.3',execPath:realpathSync(f.command),executableSha256:f.manifest.executableSha256}}},runtime)).toBe(true);
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
 it('development and targets outside the qualified matrix leave the existing resolver in control',()=>{
  expect(resolvePackagedBrokerRuntime({isPackaged:false,resourcesPath:'/unused',env:{}})).toBeNull();
  expect(resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:'/unused',platform:'linux',arch:'x64',env:{}})).toBeNull();
 });
 it('missing runtime fails closed, with no environment fallback',()=>{
  const root=mkdtempSync(join(tmpdir(),'broker-runtime-missing-'));roots.push(root);
  expect(()=>resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:root,platform:'win32',arch:'x64',env:{XIAOK_NODE_CMD:'node'}})).toThrow();
 });
 it('changed binary, changed provenance and aliased binary are rejected',()=>{
  const f=fixture('darwin'),input={isPackaged:true,resourcesPath:f.root,platform:'darwin' as const,arch:'arm64',env:{}};
  resolvePackagedBrokerRuntime(input);writeFileSync(f.command,'tampered');
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
  writeFileSync(f.command,'qualified fixture executable');f.manifest.archiveSha256='0'.repeat(64);writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
  f.manifest.archiveSha256='8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d';writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
  const real=join(f.root,'elsewhere');writeFileSync(real,'qualified fixture executable');rmSync(f.command);if(process.platform==='win32')linkSync(real,f.command);else symlinkSync(real,f.command);
  expect(()=>resolvePackagedBrokerRuntime(input)).toThrow(/broker_runtime/);
 });
});
