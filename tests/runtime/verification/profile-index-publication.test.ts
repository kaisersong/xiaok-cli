import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileOwnerRegistry} from '../../../src/runtime/verification/profile-owner-registry.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import * as atomic from '../../../src/utils/atomic-file.js';
const peer={uid:501,gid:20,auditSessionId:7},accountId='11111111-2222-3333-4444-555555555555',invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},proposal={ownerKind:'task' as const,ownerId:'t',invocations:[invocation]};
function fixture(){const root=mkdtempSync(join(tmpdir(),'profile-index-')),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});const database=openPrivateVerificationDatabase(join(root,'db'));
 const publisher=createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent:()=>{}});
 const registry=createProfileOwnerRegistry({database,authorityId:'authority',resolvePrincipal:()=>({uid:peer.uid,accountId}),assertEnrollmentCurrent:()=>{},assertEnrollmentAuthorization:()=>{},publishProfile:publisher.publish,assertProfilePublished:publisher.assertPublished});
 return{root,markers,database,publisher,registry,context:{peer,requestSource:'user' as const,authorization:{}},close:()=>{database.close();rmSync(root,{recursive:true,force:true});}};}
it('requires a committed real profile intent and publishes its exact immutable index',()=>{const f=fixture();try{
 expect(()=>f.publisher.publish({version:1,authorityId:'authority',uid:501,accountId,profileId:'forged'})).toThrow(/intent/);
 const owner=f.registry.enroll(proposal,f.context),index=JSON.parse(readFileSync(join(f.markers,'principals','501.json'),'utf8'));
 expect(index).toEqual({version:1,authorityId:'authority',uid:501,accountId,profileId:owner.profileId});
 expect(()=>f.publisher.publish({...index,accountId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'})).toThrow(/intent/);
 expect(()=>f.database.transaction(()=>f.publisher.publish(index))()).toThrow(/transaction/);
}finally{f.close();}});
it('keeps pending across real directory-fsync failure and retries the barrier even after rename',()=>{const f=fixture();try{
 const barrier=vi.spyOn(atomic,'syncDirectoryTreeStrict').mockImplementation(()=>{throw Error('directory_barrier');});
 try{expect(()=>f.registry.enroll(proposal,f.context)).toThrow('directory_barrier');expect(()=>f.registry.enroll(proposal,f.context)).toThrow('directory_barrier');expect(f.database.prepare('SELECT state FROM verification_profiles').get()).toEqual({state:'pending'});}finally{barrier.mockRestore();}
 const owner=f.registry.enroll(proposal,f.context);expect(f.registry.getProfile(peer).profileId).toBe(owner.profileId);
}finally{f.close();}});
it('never follows a symlink replacing the public principal namespace',()=>{const f=fixture();try{
 symlinkSync(f.root,join(f.markers,'principals'));expect(()=>f.registry.enroll(proposal,f.context)).toThrow(/identity/);
 expect(f.database.prepare('SELECT state FROM verification_profiles').get()).toEqual({state:'pending'});
}finally{f.close();}});
it('rejects the installed writer from an ordinary process and reads only the fixed current-user index',async()=>{
 const {createInstalledProfileIndexPublisher}=await import('../../../src/runtime/verification/installed-migration-publisher.js');
 const {readInstalledCurrentProfile}=await import('../../../src/runtime/verification/migration-markers.js');
 const f=fixture();try{expect(()=>createInstalledProfileIndexPublisher({lifetime:{database:f.database} as never})).toThrow();expect(['ordinary','protected','unavailable']).toContain(readInstalledCurrentProfile().kind);}finally{f.close();}
});
it('returns unavailable before loading macOS helpers on Windows',async()=>{
 const {readInstalledCurrentProfile}=await import('../../../src/runtime/verification/migration-markers.js');const actual=process;
 vi.stubGlobal('process',new Proxy(actual,{get(target,key){return key==='platform'?'win32':Reflect.get(target,key);}}));
 try{expect(readInstalledCurrentProfile()).toEqual({kind:'unavailable',reason:'migration_authority_unavailable'});}finally{vi.unstubAllGlobals();}
});
