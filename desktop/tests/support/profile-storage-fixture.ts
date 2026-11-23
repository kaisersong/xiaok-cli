import {existsSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {makePrivateTestTempDir} from '../../../tests/support/private-temp.js';
import {createExclusiveWindowsPrivateDirectory,writeWindowsPrivateFile} from '../../../src/runtime/windows-owner-security.js';
/** Emulate normal user ownership even when the Windows test runner is elevated. */
export function ownedProfileTempDir(prefix:string):string {
 return makePrivateTestTempDir(prefix);
}
export function ownedProfileDirectory(path:string):void {
 if(process.platform!=='win32'){mkdirSync(path,{recursive:true,mode:0o700});return;}
 const missing:string[]=[];for(let current=path;!existsSync(current);current=dirname(current))missing.push(current);
 for(const current of missing.reverse())createExclusiveWindowsPrivateDirectory(current);
}
/** A real SQLite header/schema replaces the old two zero-byte path placeholders. */
export function seedProfileGroups(root:string,profileId:string):void {
 ownedProfileDirectory(join(root,'multi-agent'));const file=join(root,'multi-agent','groups.sqlite');
 if(process.platform==='win32'&&!existsSync(file))writeWindowsPrivateFile(file,'',true);
 const db=new DatabaseSync(file);try{db.exec('PRAGMA user_version=4;CREATE TABLE IF NOT EXISTS thread_bindings(profile_id TEXT);CREATE TABLE IF NOT EXISTS workspace_execution_authorizations(profile_id TEXT,workspace_id TEXT)');db.prepare('INSERT INTO thread_bindings(profile_id) VALUES (?)').run(profileId);}finally{db.close();}
}

/** Inspection must never open an original WAL DB: even readOnly can create sidecars.
 * Fixtures have no concurrent mutation while this synchronous copy is made. */
export function openProfileDatabaseSnapshot(file:string):{db:DatabaseSync;close():void} {
 const root=ownedProfileTempDir(join(tmpdir(),'profile-fixture-read-')),copy=join(root,'snapshot.sqlite');
 try{
  copyFileSync(file,copy);if(existsSync(file+'-wal'))copyFileSync(file+'-wal',copy+'-wal');
  const db=new DatabaseSync(copy);
  return {db,close(){db.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}};
 }catch(raw){rmSync(root,{recursive:true,force:true,maxRetries:3});throw raw;}
}
