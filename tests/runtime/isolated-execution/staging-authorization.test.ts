import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {createInputStager, type StagingReadAccess} from '../../../src/runtime/isolated-execution/staging.js';
it('fails closed when the authorization port returns a rejected Promise',()=>{
const root=mkdtempSync(join(tmpdir(),'staging-async-auth-'));try{
const helper=join(root,'read'),workspace=join(root,'workspace');mkdirSync(workspace);writeFileSync(join(workspace,'file'),'denied-body');
expect(spawnSync('/usr/bin/cc',['-O2',resolve('src/runtime/verification/native/secure-read.c'),'-o',helper]).status).toBe(0);
const hash=createHash('sha256').update('denied-body').digest('hex');
const stager=createInputStager({root:join(root,'stage'),readerExecutable:helper,access:{assertLive(){},assertRead(){const denied=Promise.reject(Error('authorization_denied'));void denied.catch(()=>{});return denied;}}});
expect(()=>stager.prepareValidationInput({grant:{},workspaceRoot:workspace,files:[{path:'file',expectedContentHash:hash,byteLimit:100}],purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},command:{argv:['/bin/true'],cwdRelative:'.'}})).toThrow();
}finally{rmSync(root,{recursive:true,force:true});}});
it('freezes the grant identity as well as proposal bytes before invoking access callbacks',()=>{
const root=mkdtempSync(join(tmpdir(),'staging-grant-swap-'));try{
const helper=join(root,'read'),workspace=join(root,'workspace');mkdirSync(workspace);writeFileSync(join(workspace,'a'),'first');writeFileSync(join(workspace,'b'),'second');
expect(spawnSync('/usr/bin/cc',['-O2',resolve('src/runtime/verification/native/secure-read.c'),'-o',helper]).status).toBe(0);
const a={},b={};let revokedA=false;const input={grant:a,workspaceRoot:workspace,files:[{path:'a',expectedContentHash:createHash('sha256').update('first').digest('hex'),byteLimit:100},{path:'b',expectedContentHash:createHash('sha256').update('second').digest('hex'),byteLimit:100}],purpose:'isolated-command' as const,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},command:{argv:['/bin/true'],cwdRelative:'.'}};
const stager=createInputStager({root:join(root,'stage'),readerExecutable:helper,access:{assertLive(g){if(g===a&&revokedA)throw Error('revoked');if(g!==a&&g!==b)throw Error('forged');},assertRead(g,file){if(file.canonicalPath.endsWith('/a')){if(g!==a)throw Error('wrong-scope');input.grant=b;}else if(g!==a&&g!==b)throw Error('wrong-scope');}}});
const prepared=stager.prepareValidationInput(input);revokedA=true;
expect(()=>stager.readFile(prepared.materializedInput,'a')).toThrow();
}finally{rmSync(root,{recursive:true,force:true});}});
it('checks synchronous live admission and consumption, preserving frozen factory functions',()=>{
const root=mkdtempSync(join(tmpdir(),'staging-live-contract-'));try{
const helper=join(root,'read'),workspace=join(root,'workspace');mkdirSync(workspace);writeFileSync(join(workspace,'a'),'first');
expect(spawnSync('/usr/bin/cc',['-O2',resolve('src/runtime/verification/native/secure-read.c'),'-o',helper]).status).toBe(0);
let bad=false; const access: StagingReadAccess={assertLive(){if(bad)return Promise.reject(Error('revoked'));},assertRead(){}};
const options={root:join(root,'stage'),readerExecutable:helper,access};const stager=createInputStager(options);
const input={grant:{},workspaceRoot:workspace,files:[{path:'a',expectedContentHash:createHash('sha256').update('first').digest('hex'),byteLimit:100}],purpose:'isolated-command' as const,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},command:{argv:['/bin/true'],cwdRelative:'.'}};
const plan=stager.prepareValidationInput(input).materializedInput;
options.readerExecutable='/nonexistent'; options.access={assertLive(){},assertRead(){throw Error('changed');}};
expect(stager.readFile(plan,'a').toString()).toBe('first');
bad=true;
expect(()=>stager.getManifest(plan)).toThrow('staging_access_must_be_synchronous_void');
expect(()=>stager.readFile(plan,'a')).toThrow('staging_access_must_be_synchronous_void');
expect(()=>stager.prepareValidationInput(input)).toThrow('staging_access_must_be_synchronous_void');
}finally{rmSync(root,{recursive:true,force:true});}});
