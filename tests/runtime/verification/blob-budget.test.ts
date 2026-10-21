import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createPrimitiveBlobAuthority,createPrimitiveMaterialHarness} from '../../support/primitive-blob-authority.js';
import {readBrokerStagingCapacitySource} from '../../../src/runtime/isolated-execution/broker-staging.js';import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
const hash='a'.repeat(64);
it('reserves duplicate copies of a censused resource in one durable pool, unknown never refunds',async()=>{
 const root=mkdtempSync(join(tmpdir(),'blob-budget-')),db=openPrivateVerificationDatabase(root);const deleted=new WeakSet<object>();
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'blob-budget',engineBinding:{engineId:'e',incarnation:'one'},deletion:{assertDeleted:(proof:object)=>{if(!deleted.has(proof))throw Error('deletion_receipt');}}});
 try{
 const command={argv:['/bin/true'],cwdRelative:'.'},invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};
 const staged=await harness.stagePlan(invocation,command);
 const proposal=readBrokerStagingCapacitySource(staged.plan,db);
 const again=harness.budget.reserve(proposal);expect(again.created).toBe(false);
 expect(()=>harness.budget.reserve({...proposal,bytes:1})).toThrow(/blob_issuer_missing|conflict/);
 const restored=harness.budget.reserve(proposal);expect(restored.created).toBe(false);
 expect(()=>harness.budget.release(restored.token,{})).toThrow(/deletion/);
 const proof={};deleted.add(proof);harness.budget.release(restored.token,proof);
 expect(()=>harness.budget.reserve(proposal)).toThrow(/released/);
 }finally{harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('rejects functions and copied resource commands before executing any caller code',()=>{
 const root=mkdtempSync(join(tmpdir(),'blob-command-')),db=openPrivateVerificationDatabase(root);const budget=createPrimitiveBlobAuthority({database:db,authorityId:'blob-command',assertCurrent(){},deletion:{assertDeleted(){throw Error('no receipt');}}}).budget;let called=false;
 try{expect(Object.hasOwn(budget,'reserveWithCommit')).toBe(false);expect(Object.hasOwn(budget,'reserveBatchWithCommit')).toBe(false);for(const command of [()=>{called=true;},{kind:'transcript.prepare'},Object.freeze({})])expect(()=>budget.reserveCommand(command as object)).toThrow('capacity_command_brand');expect(called).toBe(false);}finally{budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
