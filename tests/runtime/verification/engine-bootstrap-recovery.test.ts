import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createEngineBootstrapJournal} from '../../../src/runtime/verification/engine-bootstrap-journal.js';
import {recoverPrivateEngine} from '../../../src/runtime/verification/engine-bootstrap-coordinator.js';
it('recovers the same durable VM without creation, preserving a lost phase response across reopen',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-recovery-')),db=openPrivateVerificationDatabase(root);
 const proposal={deploymentHash:'a'.repeat(64),configHash:'b'.repeat(64),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const};
 const vm={machineId:'machine',bootId:'boot',effectiveConfigHash:proposal.configHash,creationNonce:proposal.creationNonce,processUid:500,processStartIdentity:'1:2'};
 let journal=createEngineBootstrapJournal(db);journal.prepare(proposal);journal.beginCreate(proposal);let copies=0,installs=0,loaded=false,lost=true;const done=new Set<string>();
 const ports={assertCurrent(){},async observeVm(){return vm;},phases:[
 {name:'copy-engine' as const,digest:'d'.repeat(64),async apply(){copies++;done.add('copy-engine');},async isComplete(){return done.has('copy-engine');}},
 {name:'install-engine' as const,digest:'e'.repeat(64),async apply(){installs++;done.add('install-engine');if(lost){lost=false;throw Error('lost install response');}},async isComplete(){return done.has('install-engine');}},
 {name:'load-worker' as const,digest:'f'.repeat(64),async apply(){loaded=true;},async isComplete(){return loaded;}}
 ],async observe(){return {...vm,engineId:'engine'};}};
 try{
 await expect(recoverPrivateEngine({journal,proposal,ports})).rejects.toThrow('lost install response');
 expect(journal.read()?.phases?.['install-engine'].state).toBe('started');journal=createEngineBootstrapJournal(db);
 await expect(recoverPrivateEngine({journal,proposal,ports})).resolves.toMatchObject({engineId:'engine'});
 expect(copies).toBe(1);expect(installs).toBe(1);expect(loaded).toBe(true);
 await expect(recoverPrivateEngine({journal,proposal,ports:{...ports,async observeVm(){return {...vm,bootId:'other'};}}})).rejects.toThrow(/changed/);
 expect(installs).toBe(1);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('does not mark an unobserved phase complete or change its recipe after failed apply',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-recovery-refuse-')),db=openPrivateVerificationDatabase(root);const journal=createEngineBootstrapJournal(db);
 const p={deploymentHash:'a'.repeat(64),configHash:'b'.repeat(64),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const};journal.prepare(p);journal.beginCreate(p);
 const vm={machineId:'machine',bootId:'boot',effectiveConfigHash:p.configHash,creationNonce:p.creationNonce,processUid:500,processStartIdentity:'1:2'};
 const phases=['copy-engine','install-engine','load-worker'].map((name,i)=>({name,digest:String(i+1).repeat(64),async apply(){},async isComplete(){return false;}}));
 const ports={assertCurrent(){},async observeVm(){return vm;},phases,async observe(){return {...vm,engineId:'engine'};}};
 try{await expect(recoverPrivateEngine({journal,proposal:p,ports} as any)).rejects.toThrow('engine_phase_not_complete');expect(journal.read()?.phases?.['copy-engine'].state).toBe('started');phases[0].digest='f'.repeat(64);await expect(recoverPrivateEngine({journal,proposal:p,ports} as any)).rejects.toThrow('engine_phase_conflict');}finally{db.close();rmSync(root,{recursive:true,force:true});}
});
