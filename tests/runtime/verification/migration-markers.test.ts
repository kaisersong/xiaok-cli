import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseMigrationMarker,assertServiceProtectedMarkerPath,readInstalledMigrationOwner} from '../../../src/runtime/verification/migration-markers.js';
const marker={version:1,state:'pending',authorityId:'controller',profileId:'p',ownerKind:'task',ownerId:'t',migrationId:'m',sourceSessionId:'s',sourceStoreRevision:1,sourceSnapshotHash:'a'.repeat(64),migrationEpoch:1};
it('keeps pending distinct from ordinary, binds immutable import facts and rejects malformed or ambiguous markers',()=>{
 expect(parseMigrationMarker(marker)).toEqual(marker);
 expect(Object.isFrozen(parseMigrationMarker(marker))).toBe(true);
 expect(parseMigrationMarker({...marker,state:'migrated',importReceiptHash:'b'.repeat(64)})).toMatchObject({state:'migrated'});
 for(const bad of [{...marker,state:'ordinary'},{...marker,importReceiptHash:'b'.repeat(64)},{...marker,state:'migrated'},{...marker,migrationEpoch:0},{...marker,extra:true}])expect(()=>parseMigrationMarker(bad)).toThrow();
 let reads=0;expect(()=>parseMigrationMarker({...marker,get sourceSnapshotHash(){reads++;return 'a'.repeat(64);}})).toThrow();expect(reads).toBe(0);
});
it('rejects a user-owned or symlinked alleged service marker from real filesystem facts',()=>{
 const root=mkdtempSync(join(tmpdir(),'migration-marker-'));try{
  const dir=join(root,'markers');mkdirSync(dir);const file=join(dir,'marker.json');writeFileSync(file,JSON.stringify(marker));
  const uid=process.getuid?.()??501;
  expect(()=>assertServiceProtectedMarkerPath(file,{serviceUid:uid+1,kind:'file',root:dir})).toThrow(/marker/);
  symlinkSync(file,join(dir,'alias'));
  expect(()=>assertServiceProtectedMarkerPath(join(dir,'alias'),{serviceUid:uid,kind:'file',root:dir})).toThrow(/marker/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('checks the fixed installation instead of accepting a caller-selected root',()=>{
 const state=readInstalledMigrationOwner({profileId:'marker-boundary-probe',ownerKind:'task',ownerId:'task'});
 // This machine's real install may be absent or incomplete; neither is a qualification claim.
 expect(['ordinary','protected-unregistered','pending','migrated','unavailable']).toContain(state.kind);
 expect(()=>readInstalledMigrationOwner({profileId:'../escape',ownerKind:'task',ownerId:'task'} as never)).not.toThrow();
});
it('does not expose the installed marker writer to this ordinary user process',async()=>{
 const {createInstalledMigrationMarkerPublisher}=await import('../../../src/runtime/verification/installed-migration-publisher.js');
 const {openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');
 const root=mkdtempSync(join(tmpdir(),'marker-install-negative-')),db=openPrivateVerificationDatabase(root);
 try{expect(()=>createInstalledMigrationMarkerPublisher({database:db,assertAuthorized:()=>{}})).toThrow();}finally{db.close();rmSync(root,{recursive:true,force:true});}
});
