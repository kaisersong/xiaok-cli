import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { coordinatorFixture } from './helpers/coordinator-fixture.mjs';
import { sign } from '../src/crypto.mjs';
async function setup(t){
 const f=coordinatorFixture(t),root=path.dirname(f.opts.stateDir),options={identity:f.identity,stateDir:path.join(root,'deployment-state'),witnessDir:path.join(root,'deployment-witness'),testProvisioningDir:path.join(root,'provisioning'),initialize:true};
 const {claimCoordinatorProvisioning}=await import('../src/provisioning.mjs');return {f,root,options,claim:claimCoordinatorProvisioning};
}
test('provisioning is consumed once and binds both canonical directories and full identity',async t=>{
 const {f,root,options,claim}=await setup(t);claim(options);assert.throws(()=>claim(options),/provisioning_unavailable/);
 claim({...options,initialize:false});
 assert.throws(()=>claim({...options,initialize:false,stateDir:path.join(root,'other-state')}),/provisioning_unavailable/);
 assert.throws(()=>claim({...options,initialize:true,stateDir:path.join(root,'new-state'),witnessDir:path.join(root,'new-witness')}),/provisioning_unavailable/);
 const identity=structuredClone(f.identity);identity.certificate.body.generation=2;assert.throws(()=>claim({...options,identity,initialize:false}));
});
test('missing or altered provisioning cannot be repaired by normal startup',async t=>{
 const {options,claim}=await setup(t);assert.throws(()=>claim({...options,initialize:false}),/provisioning_unavailable/);
 claim(options);const filename=path.join(options.testProvisioningDir,fs.readdirSync(options.testProvisioningDir)[0]);fs.writeFileSync(filename,'{}');assert.throws(()=>claim({...options,initialize:false}),/provisioning_unavailable/);
});
test('root-signed production certificates reject registry overrides before creating any path',async t=>{
 const {f,options,claim}=await setup(t),identity=structuredClone(f.identity);identity.certificate.body.deploymentMode='self-hosted';identity.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',identity.certificate.body],f.root.privateKey);
 assert.throws(()=>claim({...options,identity}),/test_provisioning_forbidden/);assert.equal(fs.existsSync(options.testProvisioningDir),false);assert.equal(fs.existsSync(options.stateDir),false);
 identity.certificate.body.deploymentMode='test';assert.throws(()=>claim({...options,identity}));
});
test('initialization refuses nonempty dirs and a symlinked registry without consuming a safe identity',async t=>{
 const {root,options,claim}=await setup(t);fs.mkdirSync(options.stateDir,{mode:0o700});fs.writeFileSync(path.join(options.stateDir,'old-state'),'old',{mode:0o600});assert.throws(()=>claim(options),/provisioning_unavailable/);assert.equal(fs.existsSync(options.testProvisioningDir),false);
 fs.rmSync(options.stateDir,{recursive:true});const target=path.join(root,'linked-registry');fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,options.testProvisioningDir);assert.throws(()=>claim(options));assert.deepEqual(fs.readdirSync(target),[]);
});
