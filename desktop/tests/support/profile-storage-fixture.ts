import {existsSync,mkdtempSync,mkdirSync,rmdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createExclusiveWindowsPrivateDirectory,writeWindowsPrivateFile} from '../../../src/runtime/windows-owner-security.js';
/** Emulate normal user ownership even when the Windows test runner is elevated. */
export function ownedProfileTempDir(prefix:string):string {
 const temporary=mkdtempSync(prefix);
 if(process.platform!=='win32')return temporary;
 const owned=temporary+'-owned';createExclusiveWindowsPrivateDirectory(owned);rmdirSync(temporary);return owned;
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
