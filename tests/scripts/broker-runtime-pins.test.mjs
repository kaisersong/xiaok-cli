import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, copyFileSync, constants, chmodSync, linkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {resolvePackagedBrokerRuntime, brokerRuntimeMatchesHealth} from '../../desktop/electron/broker-node-runtime.ts';
const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(new URL('../../desktop/resources/broker-runtime-lock.json', import.meta.url), 'utf8'));
function manifest(target, entry) { return {schema:'xiaok-broker-runtime/v1',target,node:lock.node,sqlite:lock.sqlite,executable:entry.executable,archiveSha256:entry.archiveSha256,executableSha256:entry.executableSha256,executableSize:entry.executableSize,licenseSha256:entry.licenseSha256,licenseSize:entry.licenseSize}; }
function fixture(t, target, valid = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'broker-pins-')));
  t.after(() => rmSync(root,{recursive:true,force:true,maxRetries:3}));
  const entry = lock.targets[target], dir = join(root,'services','intent-broker','runtime',target);
  mkdirSync(dir,{recursive:true});
  if (valid) {
    const inputs = process.env.XIAOK_TEST_BROKER_RUNTIME_INPUTS;
    assert.ok(inputs, 'positive pin tests require explicitly prepared official binary inputs');
    for (const name of [entry.executable,'LICENSE']) copyFileSync(join(inputs,target,name),join(dir,name),constants.COPYFILE_FICLONE);
  } else { writeFileSync(join(dir,entry.executable),'untrusted self-reported executable'); writeFileSync(join(dir,'LICENSE'),'forged license'); }
  const value = manifest(target,entry);writeFileSync(join(dir,'manifest.json'),JSON.stringify(value));
  const [platform,arch] = target.split('-');
  return {root,dir,entry,value,command:join(dir,entry.executable),options:{isPackaged:true,resourcesPath:root,platform,arch,env:{}}};
}
test('a package manifest cannot mint an arbitrary executable pin', t => {
  const f=fixture(t,'darwin-arm64',false);
  f.value.executableSha256=createHash('sha256').update(readFileSync(f.command)).digest('hex');
  writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.value));
  assert.throws(()=>resolvePackagedBrokerRuntime(f.options),/broker_runtime/);
});
for (const target of ['darwin-arm64','win32-x64']) test(`actual official bytes verify on ${target} without granting Native qualification`,t=>{
  const f=fixture(t,target);const runtime=resolvePackagedBrokerRuntime(f.options);
  assert.equal(runtime.command,f.command);
  assert.deepEqual(runtime.expected,{node:'24.19.0',sqlite:'3.53.3',executableSha256:f.entry.executableSha256});
  const health={service:{runtime:{...runtime.expected,execPath:f.command}}};
  assert.equal(brokerRuntimeMatchesHealth(health,runtime),true);
  assert.equal(brokerRuntimeMatchesHealth({service:{runtime:{...health.service.runtime,node:'22.14.0'}}},runtime),false);
  assert.equal(brokerRuntimeMatchesHealth({service:{runtime:{...health.service.runtime,execPath:join(f.root,'other')}}},runtime),false);
});
test('closed manifest, fixed license, changed bytes and aliases all deny',t=>{
  const f=fixture(t,'darwin-arm64');
  writeFileSync(join(f.dir,'manifest.json'),JSON.stringify({...f.value,qualified:true}));
  assert.throws(()=>resolvePackagedBrokerRuntime(f.options),/broker_runtime/);
  writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.value));
  chmodSync(join(f.dir,'LICENSE'),0o600);writeFileSync(join(f.dir,'LICENSE'),'changed');assert.throws(()=>resolvePackagedBrokerRuntime(f.options),/broker_runtime/);
  copyFileSync(join(process.env.XIAOK_TEST_BROKER_RUNTIME_INPUTS,'darwin-arm64','LICENSE'),join(f.dir,'LICENSE'));
  const original=join(f.root,'original');copyFileSync(f.command,original,constants.COPYFILE_FICLONE);rmSync(f.command);linkSync(original,f.command);
  assert.throws(()=>resolvePackagedBrokerRuntime(f.options),/broker_runtime_alias/);
});
test('ordinary packaged Broker strips injection variants but preserves selected ports and caller environment',t=>{
  const f=fixture(t,'darwin-arm64');const env=Object.freeze({NODE_OPTIONS:'--require=bad',Node_Path:'bad',xiaok_node_cmd:'bad',eLeCtRoN_RuN_aS_nOdE:'1',DYLD_INSERT_LIBRARIES:'bad',ld_preload:'bad',XIAOK_DESKTOP_PORT:'45831',INTENT_BROKER_PORT:'45831',KSWARM_PORT:'45832',KEEP:'yes'});
  const runtime=resolvePackagedBrokerRuntime({...f.options,env});
  assert.deepEqual({...runtime.env},{XIAOK_DESKTOP_PORT:'45831',INTENT_BROKER_PORT:'45831',KSWARM_PORT:'45832',KEEP:'yes'});
  assert.equal(env.NODE_OPTIONS,'--require=bad');
});
test('Proxy/accessor environment rejected without traps/getters and unsupported profiles preserve legacy',t=>{
  const f=fixture(t,'darwin-arm64');let traps=0;
  assert.throws(()=>resolvePackagedBrokerRuntime({...f.options,env:new Proxy({}, {ownKeys(){traps++;return [];}})}),/broker_runtime_env/);
  assert.equal(traps,0);let gets=0;const env={};Object.defineProperty(env,'NODE_OPTIONS',{get(){gets++;return '';},enumerable:true});
  assert.throws(()=>resolvePackagedBrokerRuntime({...f.options,env}),/broker_runtime_env/);assert.equal(gets,0);
  assert.equal(resolvePackagedBrokerRuntime({isPackaged:false,resourcesPath:'/unused'}),null);
  assert.equal(resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:'/unused',platform:'linux',arch:'x64'}),null);
});
test('missing supported runtime refuses environment fallback',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'broker-missing-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.throws(()=>resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:root,platform:'win32',arch:'x64',env:{XIAOK_NODE_CMD:'node'}}));
});

test('shared JSON and returned profile objects cannot alter private runtime pins',t=>{
 const f=fixture(t,'darwin-arm64');const api=require('../../desktop/electron/broker-runtime-package.cjs');
 const entry=api.targetEntry('darwin-arm64');assert.equal(Object.isFrozen(entry),true);
 assert.throws(()=>{entry.executableSha256='0'.repeat(64);},TypeError);
 const shared=require('../../desktop/resources/broker-runtime-lock.json');const before=shared.targets['darwin-arm64'].executableSha256;
 try{shared.targets['darwin-arm64'].executableSha256='0'.repeat(64);assert.equal(resolvePackagedBrokerRuntime(f.options).expected.executableSha256,before);}
 finally{shared.targets['darwin-arm64'].executableSha256=before;}
});
