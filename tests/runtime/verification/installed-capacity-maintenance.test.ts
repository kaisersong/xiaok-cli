import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createPrimitiveSharedCapacityHarness} from '../../support/primitive-blob-authority.js';
import {createHash} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createProfileOwnerRegistry} from '../../../src/runtime/verification/profile-owner-registry.js';
import {createInstalledCapacityMaintenance,readExistingMaintenancePage} from '../../../src/runtime/verification/installed-capacity-maintenance.js';
it.each(['normal','pending','invalid','foreign'] as const)('reads original registry and budget metadata only: %s',mode=>{const root=mkdtempSync(join(tmpdir(),'maintenance-')),db=openPrivateVerificationDatabase(join(root,'db'));const account='11111111-2222-3333-4444-555555555555',peer={uid:501,gid:20,auditSessionId:2},permits=new WeakSet<object>();
 const registry=createProfileOwnerRegistry({database:db,authorityId:'authority',resolvePrincipal:p=>({uid:p.uid,accountId:account}),assertEnrollmentAuthorization(_p,c){if(!permits.delete(c.authorization))throw Error('not approved');},assertEnrollmentCurrent(){},publishProfile(){},assertProfilePublished(){}}),permit={};permits.add(permit);const invocation={sessionIdentity:'session',compoundOperationId:'op',validationInvocationId:'validation'};registry.enroll({ownerKind:'task',ownerId:'task',invocations:[invocation]},{peer,requestSource:'user',authorization:permit});
 const owner=registry.resolveOwnerKey(peer,invocation),deletion={assertDeleted(){throw Error('no deletion');}},primitive=createPrimitiveSharedCapacityHarness({database:db,authorityId:'authority',assertCurrent(){},deletion}),capacity=primitive.shared,budget=primitive.budget;
 const seed=(o:string,r:string,digest:string)=>{const proposal={ownerKey:o,resourceId:r,kind:'host-staging' as const,bytes:1,scopeDigest:digest},tuple=json(proposal);db.prepare('INSERT INTO verification_blob_reservations VALUES(?,?,?,?,?,?,?,?)').run('authority-'+createHash('sha256').update('authority').digest('hex'),r,o,'host-staging',1,createHash('sha256').update(tuple).digest('hex'),tuple,'reserved');};
 try{
 seed(owner,'resource','a'.repeat(64));seed('other','hidden','b'.repeat(64));db.prepare("UPDATE verification_blob_reservations SET tuple_json='not JSON /private/other' WHERE resource_id='hidden'").run();
 const request={requestSource:'user' as const,ownerKind:'task',ownerId:'task',after:null,limit:16},principal={uid:501,accountGeneration:account.toUpperCase()};
 if(mode==='pending')db.prepare("UPDATE verification_registered_invocations SET state='pending' WHERE owner_key=?").run(owner);
 if(mode==='invalid')db.prepare('UPDATE verification_registered_invocations SET invocation_json=? WHERE owner_key=?').run(json({...invocation,sessionIdentity:''}),owner);
 if(mode==='foreign')db.prepare('UPDATE verification_registered_invocations SET profile_id=? WHERE owner_key=?').run('different-profile',owner);
 if(mode!=='normal'){expect(()=>readExistingMaintenancePage(db,principal,request)).toThrow('maintenance_owner_unavailable');return;}
 expect(readExistingMaintenancePage(db,principal,request)).toEqual(expect.objectContaining({items:[{resourceId:'resource',kind:'host-staging',state:'reserved',mapping:'unmapped',reason:'capacity_mapping_missing'}],nextAfter:null}));expect(()=>readExistingMaintenancePage(db,{...principal,uid:502},request)).toThrow('maintenance_owner_unavailable');expect(()=>readExistingMaintenancePage(db,principal,{...request,requestSource:'agent'} as any)).toThrow('maintenance_request');expect(db.prepare('SELECT COUNT(*) n FROM verification_registered_owners').get()).toEqual({n:1});expect(capacity.diagnoseLegacy()).toHaveLength(2);
 expect(()=>createInstalledCapacityMaintenance({lifetime:{database:db},broker:{},capacity} as any)).toThrow('controller_lifetime_identity');
 }finally{budget.close();capacity.close();db.close();rmSync(root,{recursive:true,force:true});}});
