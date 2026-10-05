import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveMaterialHarness} from '../../support/primitive-blob-authority.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
it('charges before broker reads, freezes real bytes and invalidates later reads after grant revoke',async()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-stager-')),db=openPrivateVerificationDatabase(join(root,'db')),bytes=Buffer.from('actual frozen script'),sha=createHash('sha256').update(bytes).digest('hex');let live=true,reads=0;
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'broker-staging',engineBinding:{engineId:'e',incarnation:'b'},ownerKey:'owner',assertCleanup(){},deletion:{assertDeleted(proof,proposal){harness.pipeline.stager.deletionAuthority.assertDeleted(proof,proposal);}}});
 try{
  const peer=harness.peer,command={argv:['/bin/true'],cwdRelative:'.'},invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},signal=new AbortController().signal;
   const draft={purpose:'isolated-command' as const,invocation,materials:[{path:'/workspace/input',byteLimit:4096}],exactCommand:command,expiresAt:61000};
  const challenge=await harness.pipeline.prepare(draft,peer,signal);
  const grant=await harness.pipeline.authorize(challenge.challengeId,peer,signal);
  const stager=harness.pipeline.stager;
  db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');
  const staged=await harness.pipeline.stage({grantHandle:grant,invocation},peer,signal);
  expect(staged.scopeDigest).toBeDefined();
  const resource=(db.prepare("SELECT resource_id FROM broker_staging_intents WHERE state='published'").get() as {resource_id:string}).resource_id;
  expect(db.prepare('SELECT state FROM verification_blob_reservations WHERE resource_id=?').get(resource)).toEqual({state:'reserved'});
  live=false;stager.deleteResource(resource);
  expect(db.prepare('SELECT state FROM broker_staging_intents WHERE resource_id=?').get(resource)).toEqual({state:'deleted'});
  expect(db.prepare('SELECT state FROM verification_blob_reservations WHERE resource_id=?').get(resource)).not.toEqual({state:'reserved'});
 }finally{harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('cleans an unpublished failed staging using exact private ownership and keeps the old scope non-replayable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-stager-failed-')),db=openPrivateVerificationDatabase(join(root,'db')); const harness=createPrimitiveMaterialHarness({database:db,authorityId:'broker-staging',engineBinding:{engineId:'e',incarnation:'b'},ownerKey:'owner',readPageFault(){throw Error('broker read failed');}});
 try{
  const peer=harness.peer,command={argv:['/bin/true'],cwdRelative:'.'},invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},signal=new AbortController().signal;
  const draft={purpose:'isolated-command' as const,invocation,materials:[{path:'/workspace/input',byteLimit:4096}],exactCommand:command,expiresAt:61000};
  const challenge=await harness.pipeline.prepare(draft,peer,signal);
  const grant=await harness.pipeline.authorize(challenge.challengeId,peer,signal);
  // Simulate the broker read failing after the durable staging intent exists.
  await expect(harness.pipeline.stage({grantHandle:grant,invocation},peer,signal)).rejects.toThrow(/broker read failed|broker_staging_failed_cleanup_unknown/);
  const rows=db.prepare('SELECT state FROM verification_blob_reservations').all();
  expect(rows.length).toBeGreaterThanOrEqual(1);
 }finally{harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
