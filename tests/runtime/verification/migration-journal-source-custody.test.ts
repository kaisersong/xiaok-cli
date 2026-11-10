import {afterEach,expect,it,vi} from 'vitest';
const seam=vi.hoisted(()=>({sync:undefined as undefined|(()=>void),closed:[] as number[]}));
vi.mock('node:fs',async()=>{
  const original=await vi.importActual<typeof import('node:fs')>('node:fs');
  return {...original,fsyncSync(fd:number){seam.sync?.();return original.fsyncSync(fd);},closeSync(fd:number){seam.closed.push(fd);return original.closeSync(fd);}};
});
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createMigrationMarkerJournal} from '../../../src/runtime/verification/migration-marker-journal.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {parseMainRootFamilyEnrollmentRecord,mainRootFamilyTargets} from '../../../src/runtime/verification/main-root-family-enrollment-data.js';
import {runVerificationTransaction} from '../../../src/runtime/verification/storage-budget.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{seam.sync=undefined;const failures=[];for(const dispose of cleanup.splice(0).reverse())try{await dispose();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'journal fixture cleanup');});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'migration-custody-')),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});const database=openPrivateVerificationDatabase(join(root,'db'));let keep=false;
 const journal=createMigrationMarkerJournal({root:markers,database,authorityId:'authority',assertCurrent(){},assertAuthorized(){throw Error('not business marker');}});
 const record=parseMainRootFamilyEnrollmentRecord({version:1,purpose:'main-root-family-enrollment',state:'pending',phase:'prepared',boot:'boot',requestId:'request',review:{version:1,purpose:'main-root-family-enrollment',authorizationScope:'pending-only',authorityId:'authority',operationId:'operation',challengeId:'challenge',profileId:'profile',principal:{uid:501,gid:20,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000},targets:mainRootFamilyTargets()}});
 runVerificationTransaction(database,()=>journal.prepareMainRootFamilyIntent(record));
 cleanup.push(async()=>{if(keep){expect(database.open).toBe(true);expect(existsSync(root)).toBe(true);return;}await journal.closeMainRootFamily();database.close();rmSync(root,{recursive:true,force:true});});
 return {root,database,journal,publish:()=>journal.publishMainRootFamilyPending(record),keep(){keep=true;}};
}
it('uses the actual journal atomic writer and drains its real descriptors',async()=>{
 const f=fixture();f.publish();expect(()=>f.journal.assertMainRootFamilyPhysicalKnown()).not.toThrow();await f.journal.closeMainRootFamily();expect(seam.closed.length).toBeGreaterThan(0);
});
it('preserves an Error with a held own-symbol tail and closes the real fd only after that original tail settles',async()=>{
 const f=fixture();let release!:()=>void,ended=false,once=true;const held=new Promise<void>(yes=>{release=yes;}),failure=Error('fsync original');Object.defineProperty(failure,Symbol('held'),{value:held});
 seam.sync=()=>{if(once){once=false;throw failure;}};expect(()=>f.publish()).toThrow(failure);const count=seam.closed.length;
 const close=f.journal.closeMainRootFamily().then(()=>{ended=true;});await Promise.resolve();await Promise.resolve();expect(ended).toBe(false);expect(seam.closed.length).toBe(count);release();await close;expect(seam.closed.length).toBeGreaterThan(count);
});
it('preserves throw undefined as the first SDK error and attempts known cleanup',async()=>{
 const f=fixture();let once=true,caught=false;seam.sync=()=>{if(once){once=false;throw undefined;}};
 try{f.publish();}catch(error){caught=true;expect(error).toBeUndefined();}expect(caught).toBe(true);await f.journal.closeMainRootFamily();
});
it('joins a known fd SDK tail even alongside an unknown accessor and keeps the actual database on unknown',async()=>{
 const f=fixture();let release!:()=>void,ended=false,once=true,touched=0;const held=new Promise<void>(yes=>{release=yes;}),failure=Error('unknown fsync');Object.defineProperties(failure,{cause:{value:held},opaque:{get(){touched++;return 1;}}});
 seam.sync=()=>{if(once){once=false;throw failure;}};expect(()=>f.publish()).toThrow(failure);f.keep();const count=seam.closed.length;
 const close=f.journal.closeMainRootFamily().catch(error=>{ended=true;return error;});await Promise.resolve();await Promise.resolve();expect(ended).toBe(false);expect(seam.closed.length).toBe(count);release();expect(await close).toBeInstanceOf(Error);expect(seam.closed.length).toBeGreaterThan(count);expect(touched).toBe(0);
});
