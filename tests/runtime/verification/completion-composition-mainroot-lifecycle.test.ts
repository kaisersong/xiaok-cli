import {afterEach,expect,it,vi} from 'vitest';
const seam=vi.hoisted(()=>({oldClose:0,boundaryClose:0,mainClose:0,failOld:false,failConstruct:false,failBoundary:false,first:undefined as unknown}));
vi.mock('../../../src/runtime/verification/owner-enrollment-authority.js',async()=>{
 const actual=await vi.importActual<typeof import('../../../src/runtime/verification/owner-enrollment-authority.js')>('../../../src/runtime/verification/owner-enrollment-authority.js');
 return {...actual,createOwnerEnrollmentAuthority(input:any){const original=actual.createOwnerEnrollmentAuthority(input);return Object.freeze({...original,close(){seam.oldClose++;original.close();if(seam.failOld)throw seam.first;}});}};
});
vi.mock('../../../src/runtime/verification/completion-boundary.js',async()=>{
 const actual=await vi.importActual<typeof import('../../../src/runtime/verification/completion-boundary.js')>('../../../src/runtime/verification/completion-boundary.js');
 return {...actual,createCompletionBoundary(input:any){const original=actual.createCompletionBoundary(input);return Object.freeze({...original,close(){seam.boundaryClose++;original.close();if(seam.failBoundary)throw Error('boundary secondary');}});}};
});
vi.mock('../../../src/runtime/verification/main-root-family-enrollment-authority.js',async()=>{
 const actual=await vi.importActual<typeof import('../../../src/runtime/verification/main-root-family-enrollment-authority.js')>('../../../src/runtime/verification/main-root-family-enrollment-authority.js');
 return {...actual,createMainRootFamilyEnrollmentAuthority(input:any){if(seam.failConstruct)throw seam.first;const original=actual.createMainRootFamilyEnrollmentAuthority(input);return Object.freeze({...original,async close(){seam.mainClose++;await original.close();}});}};
});
import {generateKeyPairSync} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {createMigrationMarkerJournal} from '../../../src/runtime/verification/migration-marker-journal.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{seam.failOld=seam.failConstruct=seam.failBoundary=false;const errors=[];for(const close of cleanups.splice(0).reverse())try{await close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'lifecycle fixture cleanup');seam.oldClose=seam.boundaryClose=seam.mainClose=0;seam.first=undefined;});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'mainroot-compose-life-')),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});const database=openPrivateVerificationDatabase(join(root,'db')),keys=generateKeyPairSync('ed25519'),H='a'.repeat(64);
 const publication=createMigrationMarkerJournal({root:markers,database,authorityId:'authority',assertCurrent(){},assertAuthorized(){throw Error('unused');}});
 let composition:ReturnType<typeof createVerificationCompletionComposition>|undefined;
 cleanups.push(async()=>{await publication.closeMainRootFamily();database.close();rmSync(root,{recursive:true,force:true});});
 const build=()=>composition=createVerificationCompletionComposition({root,database,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),assertQualified(){},quiescence:{assertQuiescent(){}}},enrollment:{resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),approve:async()=>{throw Error('unused');},profilePublication:createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}}),mainRootFamily:{publication,assertCurrent(){},approve:async()=>{throw Error('unused');}}},recipePorts:{assertCurrent(){},assertFailedRunComplete(){throw Error('unused');},readArtifact:async()=>{throw Error('unused');},runBlackbox:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');}}});
 return {build,database};
}
it.each([undefined,Error('constructor original')])('closes previously born original components if the private MainRoot constructor throws %s',first=>{
 const f=fixture();seam.failConstruct=true;seam.first=first;let caught=false;
 try{f.build();}catch(error){caught=true;expect(error).toBe(first);}expect(caught).toBe(true);expect(seam.oldClose).toBe(1);expect(seam.boundaryClose).toBe(1);expect(f.database.open).toBe(true);
});
it('attempts the MainRoot journal and original boundary close after an original enrollment close throw undefined, preserving that first cause',async()=>{
 const f=fixture(),composition=f.build();seam.failOld=true;seam.failBoundary=true;let caught=false;
 try{await composition.close();}catch(error){caught=true;expect(error).toBeUndefined();}
 expect(caught).toBe(true);expect(seam.oldClose).toBe(1);expect(seam.mainClose).toBe(1);expect(seam.boundaryClose).toBe(1);expect(f.database.open).toBe(true);
});
