import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createEngineBootstrapJournal} from '../../../src/runtime/verification/engine-bootstrap-journal.js';
import {bootstrapPrivateEngine} from '../../../src/runtime/verification/engine-bootstrap-coordinator.js';
it('commits create intent before the actual start port and never replays an unknown VM creation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-bootstrap-order-')),database=openPrivateVerificationDatabase(root),journal=createEngineBootstrapJournal(database);let starts=0;
 const proposal={deploymentHash:'a'.repeat(64),configHash:'b'.repeat(64),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const};
 const observation={machineId:'machine',bootId:'boot',engineId:'engine',effectiveConfigHash:proposal.configHash,creationNonce:proposal.creationNonce,processUid:500,processStartIdentity:'1:2'};
 const ports={assertCurrent(){},async create(){starts++;expect(journal.read()?.state).toBe('create_started');throw Error('lost response');},async initialize(){throw Error('must not initialize unknown');},async observe(){return observation;}};
 try{
  await expect(bootstrapPrivateEngine({journal,proposal,ports})).rejects.toThrow('lost response');expect(starts).toBe(1);
  const result=await bootstrapPrivateEngine({journal,proposal,ports});expect(result).toEqual(observation);expect(starts).toBe(1);expect(journal.read()?.state).toBe('observed');
 }finally{database.close();rmSync(root,{recursive:true,force:true});}
});
it('initializes only after this call actually created the VM and refuses changed observations',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-bootstrap-observe-')),database=openPrivateVerificationDatabase(root),journal=createEngineBootstrapJournal(database);let initialized=0;
 const proposal={deploymentHash:'a'.repeat(64),configHash:'b'.repeat(64),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const};
 const observation={machineId:'machine',bootId:'boot',engineId:'engine',effectiveConfigHash:proposal.configHash,creationNonce:proposal.creationNonce,processUid:500,processStartIdentity:'1:2'};
 try{
  await bootstrapPrivateEngine({journal,proposal,ports:{assertCurrent(){},async create(){},async initialize(){initialized++;},async observe(){return observation;}}});expect(initialized).toBe(1);
  await expect(bootstrapPrivateEngine({journal,proposal,ports:{assertCurrent(){},async create(){throw Error('replay');},async initialize(){throw Error('replay');},async observe(){return {...observation,creationNonce:'d'.repeat(64)};}}})).rejects.toThrow(/observation/);
 }finally{database.close();rmSync(root,{recursive:true,force:true});}
});
