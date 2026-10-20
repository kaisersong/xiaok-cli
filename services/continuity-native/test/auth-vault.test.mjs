import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {worker}=await import('./helpers/worker.mjs');
const skip=!authBinary||process.platform!=='darwin'||process.arch!=='arm64';
const lockName='.xiaok-auth-vault-v1.lock';
const canary='SYNTHETIC_FILE_JSON_TOKEN_CANARY';

test('actual AuthOwner holds the same-root OS lock until physical exit, then reopens the original birth',{skip,timeout:45000},async t=>{
  const first=await worker(t);
  const second=await worker(t,{existingRoot:first.root,expectStartupError:true});
  assert.equal(second.isAlive(),false);assert.equal(first.isAlive(),true);
  const lockPath=path.join(first.root,lockName),birth=fs.readFileSync(lockPath),identity=fs.statSync(lockPath);
  assert.equal(identity.mode&0o777,0o600);assert.equal(identity.nlink,1);assert.ok(birth.length>0&&birth.length<=4096);
  assert.deepEqual(await first.endAndDrain(),{code:0,signal:null});
  const restarted=await worker(t,{existingRoot:first.root});
  assert.deepEqual(fs.readFileSync(lockPath),birth);assert.equal(fs.statSync(lockPath).ino,identity.ino);
  assert.deepEqual(await restarted.endAndDrain(),{code:0,signal:null});
});

for(const [name,configure] of [
  ['wide root',({root})=>fs.chmodSync(root,0o755)],
  ['unexpected fresh-root item',({root})=>fs.writeFileSync(path.join(root,'unrelated.json'),'{}',{mode:0o600})],
  ['nonempty fresh workspace',({workspace})=>fs.writeFileSync(path.join(workspace,'old-session'),'old',{mode:0o600})],
  ['wide config',({root})=>fs.chmodSync(path.join(root,'config.toml'),0o644)],
  ['auth without birth',({root})=>fs.writeFileSync(path.join(root,'auth.json'),'{}',{mode:0o600})],
  ['malformed auth without birth',({root})=>fs.writeFileSync(path.join(root,'auth.json'),`{"tokens":{"access_token":${canary}}`,{mode:0o600})],
  ['empty birth',({root})=>fs.writeFileSync(path.join(root,lockName),'',{mode:0o600})],
  ['invalid birth',({root})=>fs.writeFileSync(path.join(root,lockName),JSON.stringify({magic:canary,schema:1}),{mode:0o600})],
  ['wide birth',({root})=>{fs.writeFileSync(path.join(root,lockName),'{}',{mode:0o600});fs.chmodSync(path.join(root,lockName),0o644);}],
  ['symlink birth',({root})=>fs.symlinkSync('config.toml',path.join(root,lockName))],
  ['hardlink birth',({root})=>fs.linkSync(path.join(root,'config.toml'),path.join(root,lockName))],
]){
  test(`actual native startup rejects ${name} before original initialization`,{skip,timeout:30000},async t=>{
    const w=await worker(t,{configure,expectStartupError:true});
    assert.equal(w.isAlive(),false);
    assert.ok(!JSON.stringify(w.initialized).includes(canary));assert.ok(!w.diagnostics().includes(canary));
  });
}

for(const mode of ['keyring','auto']){
  test(`actual checked AuthOwner refuses ${mode} configuration without credential fallback`,{skip,timeout:30000},async t=>{
    const w=await worker(t,{configure:({root})=>fs.writeFileSync(path.join(root,'config.toml'),`cli_auth_credentials_store = "${mode}"\n[features]\nshell_snapshot = false\n`,{mode:0o600}),expectStartupError:true});
    assert.equal(w.isAlive(),false);
  });
}
