// @vitest-environment node
import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,existsSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {resolveDesktopProfile,loadContinuityProfile} from '../../../src/runtime/context-continuity/profile.js';
import {readContinuityProfile} from '../../../src/runtime/context-continuity/profile-identity.js';
import {createExclusiveWindowsPrivateDirectory,writeWindowsPrivateFile,publishWindowsProfileFile,inspectWindowsOwnerPath,holdWindowsProfile} from '../../../src/runtime/windows-owner-security.js';
const windows=it.skipIf(process.platform!=='win32'||process.arch!=='x64');
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(){const base=mkdtempSync(join(tmpdir(),'xiaok-profile-sid-'));roots.push(base);const root=join(base,'owned');createExclusiveWindowsPrivateDirectory(root);return root;}
const legacy=(root:string)=>createHash('sha256').update(resolve(root)).digest('hex');
function seed(root:string,domain=legacy(root)){createExclusiveWindowsPrivateDirectory(join(root,'multi-agent'));const file=join(root,'multi-agent','groups.sqlite');writeWindowsPrivateFile(file,'',true);const db=new DatabaseSync(file);try{db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(domain);}finally{db.close();}return file;}
function publish(root:string,name:'continuity-profile.json'|'continuity-profile-migration.json',record:unknown){const file=join(root,`.test-${randomUUID()}.tmp`);writeWindowsPrivateFile(file,JSON.stringify(record),true);publishWindowsProfileFile(file,join(root,name));}
function ps(script:string){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});expect(r.status,r.stderr).toBe(0);}
windows('creates a SID-owned UUID identity and reopens without a database writer lease',()=>{
 const root=fixture(),profile=loadContinuityProfile(root);expect(readContinuityProfile(root)).toBe(profile);
 seed(root,profile);const db=new DatabaseSync(join(root,'multi-agent/groups.sqlite'));
 try{expect(readContinuityProfile(root)).toBe(profile);expect(resolveDesktopProfile(root)).toEqual({profileId:profile});}finally{db.close();}
 expect(resolveDesktopProfile(root)).toEqual({profileId:profile});
});
windows('adopts same-SID legacy data without changing original bytes and preserves moved aliases',()=>{
 const root=fixture(),file=seed(root),before=readFileSync(file),old=legacy(root);const identity=resolveDesktopProfile(root);
 expect(identity.legacyProfileId).toBe(old);expect(readFileSync(file)).toEqual(before);expect(resolveDesktopProfile(root)).toEqual(identity);
 const record=JSON.parse(readFileSync(join(root,'continuity-profile.json'),'utf8'));expect(record).toMatchObject({version:2,profileId:identity.profileId,osOwnerSid:inspectWindowsOwnerPath(root).currentSid});
 const moved=root+'-moved';renameSync(root,moved);roots.push(moved);expect(resolveDesktopProfile(moved)).toEqual(identity);
});
windows('rejects a UUID-born root that later acquires its path digest instead of manufacturing an alias',()=>{
 const root=fixture(),profile=loadContinuityProfile(root),file=seed(root),before=readFileSync(file);
 expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');expect(readContinuityProfile(root)).toBe(profile);expect(existsSync(join(root,'continuity-profile-migration.json'))).toBe(false);expect(readFileSync(file)).toEqual(before);
});
windows('foreign domains and Everyone ACL cannot be repaired into migration evidence',()=>{
 const foreign=fixture();seed(foreign,'f'.repeat(64));expect(()=>resolveDesktopProfile(foreign)).toThrow('profile_identity_unavailable');expect(existsSync(join(foreign,'continuity-profile.json'))).toBe(false);
 const root=fixture(),file=seed(root);ps(`$p='${file.replace(/'/g,"''")}';$a=Get-Acl -LiteralPath $p;$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')));Set-Acl -LiteralPath $p -AclObject $a`);const before=inspectWindowsOwnerPath(file).sddl;
 expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');expect(inspectWindowsOwnerPath(file).sddl).toBe(before);expect(existsSync(join(root,'continuity-profile.json'))).toBe(false);expect(existsSync(join(root,'continuity-profile-migration.json'))).toBe(false);
});
windows('recovers a durable prepared alias with the exact UUID and rejects changed SID or UUID',()=>{
 const root=fixture();seed(root);const profileId=randomUUID(),sid=inspectWindowsOwnerPath(root).currentSid;
 publish(root,'continuity-profile-migration.json',{version:2,profileId,legacyProfileId:legacy(root),osOwnerSid:sid});expect(existsSync(join(root,'continuity-profile.json'))).toBe(false);
 expect(resolveDesktopProfile(root)).toEqual({profileId,legacyProfileId:legacy(root)});expect(readContinuityProfile(root)).toBe(profileId);
 const wrong=fixture();seed(wrong);publish(wrong,'continuity-profile-migration.json',{version:2,profileId,legacyProfileId:legacy(wrong),osOwnerSid:'S-1-5-21-1-2-3-1001'});expect(()=>resolveDesktopProfile(wrong)).toThrow('profile_identity_unavailable');expect(existsSync(join(wrong,'continuity-profile.json'))).toBe(false);
 const mismatch=fixture();seed(mismatch);publish(mismatch,'continuity-profile-migration.json',{version:2,profileId,legacyProfileId:legacy(mismatch),osOwnerSid:sid});publish(mismatch,'continuity-profile.json',{version:2,profileId:randomUUID(),osOwnerSid:sid});expect(()=>resolveDesktopProfile(mismatch)).toThrow('profile_identity_unavailable');
});
windows('serializes initialization and refuses an active SQLite writer before publishing identity',()=>{
 const root=fixture(),file=seed(root);const lease=holdWindowsProfile(root,true);try{expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');}finally{lease.close();}
 const db=new DatabaseSync(file);try{expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');expect(existsSync(join(root,'continuity-profile.json'))).toBe(false);}finally{db.close();}
 expect(resolveDesktopProfile(root).legacyProfileId).toBe(legacy(root));
});
windows('a legacy username is never the owner proof and a v2 foreign SID is rejected',()=>{
 const root=fixture(),profileId=randomUUID();publish(root,'continuity-profile.json',{version:1,profileId,osOwner:'renamed-account-metadata'});expect(readContinuityProfile(root)).toBe(profileId);
 const foreign=fixture();publish(foreign,'continuity-profile.json',{version:2,profileId,osOwnerSid:'S-1-5-21-1-2-3-1001'});expect(()=>readContinuityProfile(foreign)).toThrow('profile_identity_unavailable');
});
windows('existing UUID can be reopened while its same-SID database has an idle writable WAL',()=>{
 const root=fixture(),profile=loadContinuityProfile(root),file=seed(root,profile);const db=new DatabaseSync(file);
 try{db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(profile);expect(existsSync(file+'-wal')).toBe(true);expect(resolveDesktopProfile(root)).toEqual({profileId:profile});expect(existsSync(join(root,'continuity-profile-migration.json'))).toBe(false);}finally{db.close();}
});
