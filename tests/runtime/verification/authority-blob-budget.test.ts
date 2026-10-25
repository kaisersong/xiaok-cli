import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveSharedCapacityHarness} from '../../support/primitive-blob-authority.js';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
it('shares one durable authority pool across logical profiles while preserving exact profile-owner identities',()=>{
 const root=mkdtempSync(join(tmpdir(),'authority-budget-')),db=openPrivateVerificationDatabase(root),options={database:db,authorityId:'installed-authority',assertCurrent(){},deletion:{assertDeleted(){throw Error('no physical receipt');}}};
 try{
  // The modern budget only admits censused resources through branded commands;
  // unregistered direct proposals are rejected instead of silently allocated.
  const budget=createPrimitiveSharedCapacityHarness(options).budget!;
  const proposal=(i:number)=>({ownerKey:json({profileId:'profile-'+i,ownerKind:'task',ownerId:'same-owner-id'}),resourceId:'resource-'+i,kind:'host-staging' as const,bytes:1,scopeDigest:'a'.repeat(64)});
  expect(()=>budget.reserve(proposal(0))).toThrow('shared_blob_legacy_binding');
  // Historical rows (pre-migration writers) still share exactly one durable
  // authority pool while preserving exact profile-owner identities.
  const poolId='authority-'+createHash('sha256').update('installed-authority').digest('hex');
  const seed=(i:number)=>{const p=proposal(i),tuple=json(p);db.prepare('INSERT INTO verification_blob_reservations VALUES(?,?,?,?,?,?,?,?)').run(poolId,p.resourceId,p.ownerKey,p.kind,p.bytes,createHash('sha256').update(tuple).digest('hex'),tuple,'reserved');};
  for(let i=0;i<8;i++)seed(i);
  expect(db.prepare('SELECT count(DISTINCT profile_id) n FROM verification_blob_reservations').get()).toEqual({n:1});
  for(let i=0;i<8;i++)expect(budget.getState(proposal(i))).toBe('reserved');
  budget.close();
  const reopened=createPrimitiveSharedCapacityHarness(options).budget!;
  for(let i=0;i<8;i++)expect(reopened.getState(proposal(i))).toBe('reserved');
  expect(()=>createPrimitiveSharedCapacityHarness({...options,authorityId:'fresh-fake-authority'})).toThrow(/authority_pool_changed|shared_capacity_pool_identity/);
  expect(db.prepare('SELECT count(DISTINCT profile_id) n FROM verification_blob_reservations').get()).toEqual({n:1});
 } finally{db.close();rmSync(root,{recursive:true,force:true});}
});
