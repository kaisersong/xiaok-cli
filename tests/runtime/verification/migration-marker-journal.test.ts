import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createMigrationMarkerJournal} from '../../../src/runtime/verification/migration-marker-journal.js';
import {migrationOwnerFileName,migrationProfileDirectoryName} from '../../../src/runtime/verification/migration-markers.js';
import * as atomic from '../../../src/utils/atomic-file.js';
const marker={version:1 as const,state:'pending' as const,authorityId:'controller',profileId:'p',ownerKind:'task' as const,ownerId:'t',migrationId:'m',sourceSessionId:'s',sourceStoreRevision:1,sourceSnapshotHash:'a'.repeat(64),migrationEpoch:1};
function fixture(){const root=mkdtempSync(join(tmpdir(),'migration-publish-')),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});const db=openPrivateVerificationDatabase(join(root,'db')),token={};
 // External identity/authorization fixtures: real filesystem durability, not OS qualification.
 const journal=createMigrationMarkerJournal({root:markers,database:db,authorityId:'controller',assertCurrent:()=>{},assertAuthorized:(actual:object)=>{if(actual!==token)throw Error('authorization');}});
 return {root,markers,db,token,journal,path:join(markers,migrationProfileDirectoryName('p'),'owners',migrationOwnerFileName({profileId:'p',ownerKind:'task',ownerId:'t'})),close:()=>{db.close();rmSync(root,{recursive:true,force:true});}};}
it('publishes a sticky pending marker before import and only upgrades the same immutable migration tuple',()=>{
 const f=fixture();try{
  expect(()=>f.journal.publishPending(marker,{})).toThrow(/authorization/);
  f.journal.publishPending(marker,f.token);expect(JSON.parse(readFileSync(f.path,'utf8'))).toEqual(marker);
  const final={...marker,state:'migrated' as const,importReceiptHash:'b'.repeat(64)};
  expect(()=>f.journal.publishMigrated({...final,sourceStoreRevision:2},f.token)).toThrow(/conflict/);
  f.journal.publishMigrated(final,f.token);expect(JSON.parse(readFileSync(f.path,'utf8'))).toEqual(final);
  expect(()=>f.journal.publishPending(marker,f.token)).toThrow(/conflict/);expect(JSON.parse(readFileSync(f.path,'utf8'))).toEqual(final);
  expect(()=>f.journal.publishMigrated({...final,importReceiptHash:'c'.repeat(64)},f.token)).toThrow(/conflict/);
 }finally{f.close();}
});
it('does not turn an fsync failure into successful publication; exact retry still runs the barrier',()=>{
 const f=fixture();try{
  f.journal.publishPending(marker,f.token);
  const final={...marker,state:'migrated' as const,importReceiptHash:'b'.repeat(64)},barrier=vi.spyOn(atomic,'syncDirectoryTreeStrict').mockImplementation(()=>{throw Error('directory_barrier_failed');});
  try{expect(()=>f.journal.publishMigrated(final,f.token)).toThrow('directory_barrier_failed');expect(()=>f.journal.publishMigrated(final,f.token)).toThrow('directory_barrier_failed');expect(f.db.prepare('SELECT published FROM migration_publication_intents').get()).toEqual({published:0});}finally{barrier.mockRestore();}
  f.journal.publishMigrated(final,f.token);expect(f.db.prepare('SELECT published FROM migration_publication_intents').get()).toEqual({published:1});
 }finally{f.close();}
});
it('keeps a prepared intent across failure and rejects a symlink replacing the sticky namespace',()=>{
 const f=fixture();try{
  symlinkSync(f.root,join(f.markers,migrationProfileDirectoryName('p')));
  expect(()=>f.journal.publishPending(marker,f.token)).toThrow(/identity/);
  expect(f.db.prepare('SELECT published,state FROM migration_publication_intents').get()).toEqual({published:0,state:'pending'});
 }finally{f.close();}
});
it('does not publish OS marker files from an uncommitted outer transaction',()=>{
 const f=fixture();try{
  expect(()=>f.db.transaction(()=>f.journal.publishPending(marker,f.token))()).toThrow(/outer_transaction/);
  expect(f.db.prepare('SELECT count(*) n FROM migration_publication_intents').get()).toEqual({n:0});
 }finally{f.close();}
});
it('never lets a pending-only authorization complete a previously committed migrated intent',()=>{
 const f=fixture(),pendingToken={},finalToken={};
 const journal=createMigrationMarkerJournal({root:f.markers,database:f.db,authorityId:'controller',assertCurrent:()=>{},assertAuthorized:(token,m)=>{if(token!==(m.state==='pending'?pendingToken:finalToken))throw Error('wrong_scope');}});
 try{
  journal.publishPending(marker,pendingToken);const final={...marker,state:'migrated' as const,importReceiptHash:'b'.repeat(64)};
  const barrier=vi.spyOn(atomic,'syncDirectoryTreeStrict').mockImplementation(()=>{throw Error('directory_barrier_failed');});
  try{expect(()=>journal.publishMigrated(final,finalToken)).toThrow('directory_barrier_failed');}finally{barrier.mockRestore();}
  expect(f.db.prepare('SELECT state,published FROM migration_publication_intents').get()).toEqual({state:'migrated',published:0});
  expect(()=>journal.publishPending(marker,pendingToken)).toThrow(/conflict/);
  expect(f.db.prepare('SELECT published FROM migration_publication_intents').get()).toEqual({published:0});
  expect(JSON.parse(readFileSync(f.path,'utf8')).state).toBe('pending');
  journal.publishMigrated(final,finalToken);expect(f.db.prepare('SELECT published FROM migration_publication_intents').get()).toEqual({published:1});
 }finally{f.close();}
});
