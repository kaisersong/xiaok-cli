// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,renameSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {loadContinuityProfile,resolveDesktopProfile} from '../../../src/runtime/context-continuity/profile.js';
import {desktopActivityProfileId,desktopContinuityScopeProfileId,isDesktopActivityProfile} from '../../../src/runtime/conversation-activity/owner-profile-id.js';
import {createExclusiveWindowsPrivateDirectory,writeWindowsPrivateFile} from '../../../src/runtime/windows-owner-security.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(){const base=mkdtempSync(join(tmpdir(),'profile-sha-guard-'));roots.push(base);const root=join(base,'owned');if(process.platform==='win32')createExclusiveWindowsPrivateDirectory(root);else mkdirSync(root,{mode:0o700});return realpathSync(root);}
const config=(root:string,profileId:string)=>({dataRoot:root,profileRoot:root,profileId,actorId:`desktop-user:${profileId}`});
function seed(root:string){const dir=join(root,'multi-agent');if(process.platform==='win32')createExclusiveWindowsPrivateDirectory(dir);else mkdirSync(dir);const file=join(dir,'groups.sqlite');if(process.platform==='win32')writeWindowsPrivateFile(file,'',true);const db=new DatabaseSync(file);try{db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(desktopActivityProfileId(root));}finally{db.close();}}
it('a UUID-born root qualifies its own UUID scope and refuses its path digest without an alias',()=>{
 const root=fixture(),uuid=loadContinuityProfile(root);expect(isDesktopActivityProfile(config(root,desktopContinuityScopeProfileId(uuid)),root)).toBe(true);expect(isDesktopActivityProfile(config(root,desktopActivityProfileId(root)),root)).toBe(false);
});
it('a real verified legacy alias qualifies after the root moves',()=>{
 const root=fixture();seed(root);const id=resolveDesktopProfile(root);expect(id.legacyProfileId).toBe(desktopActivityProfileId(root));expect(isDesktopActivityProfile(config(root,id.legacyProfileId!),root)).toBe(true);const moved=root+'-moved';renameSync(root,moved);expect(isDesktopActivityProfile(config(moved,id.legacyProfileId!),moved)).toBe(true);
});
it.skipIf(process.platform==='win32')('an emulated platform string is never a Windows SID legacy proof',()=>{
 const root=fixture();seed(root);const original=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{...original,value:'win32'});try{expect(isDesktopActivityProfile(config(root,desktopActivityProfileId(root)),root)).toBe(false);}finally{Object.defineProperty(process,'platform',original);}
});
