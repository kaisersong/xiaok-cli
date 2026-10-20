// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cpSync,mkdirSync,mkdtempSync, realpathSync,renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadContinuityProfile,resolveDesktopProfile } from '../../electron/context-continuity/profile.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

describe('main-owned persistent continuity profile (A07)', () => {
  it('keeps the same identity after moving the data root', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuity-profile-'));
    try {
      const before = loadContinuityProfile(join(root, 'old'));
      renameSync(join(root, 'old'), join(root, 'new'));
      expect(loadContinuityProfile(join(root, 'new'))).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it('refuses symlinks/corrupt identity instead of silently issuing a new profile and adopting data', () => {
    const root = mkdtempSync(join(tmpdir(), 'continuity-profile-'));
    try {
      loadContinuityProfile(root);
      writeFileSync(join(root, 'continuity-profile.json'), '{}');
      expect(() => loadContinuityProfile(root)).toThrow('profile_identity_unavailable');
      if (process.platform !== 'win32') {
        rmSync(join(root, 'continuity-profile.json'));
        writeFileSync(join(root, 'target.json'), '{}');
        symlinkSync(join(root, 'target.json'), join(root, 'continuity-profile.json'));
        expect(() => loadContinuityProfile(root)).toThrow('profile_identity_unavailable');
      }
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it.each(['multi-agent','native','activity','audit'])('never reissues a missing identity when the %s owner retains a UUID domain or migration audit',kind=>{
    const root=mkdtempSync(join(tmpdir(),'profile-owner-'));
    try{
      const profile=loadContinuityProfile(root);rmSync(join(root,'continuity-profile.json'));
      mkdirSync(join(root,'multi-agent'));
      const db=new DatabaseSync(join(root,kind==='multi-agent'?'multi-agent/groups.sqlite':kind==='native'?'codex-native.sqlite':'conversation-activity.sqlite'));
      if(kind==='multi-agent'){db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(profile);}
      else if(kind==='native'){db.exec('CREATE TABLE codex_native_sessions(owner TEXT)');db.prepare('INSERT INTO codex_native_sessions VALUES (?)').run(`desktop-user:${profile}`);}
      else if(kind==='activity'){db.exec('PRAGMA user_version=4;CREATE TABLE thread_tombstones(profile_id TEXT)');db.prepare('INSERT INTO thread_tombstones VALUES (?)').run(profile);}
      else db.exec('PRAGMA user_version=4;CREATE TABLE profile_identity_migrations(old_profile TEXT,new_profile TEXT)');
      db.close();expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('allows only an independently owned current-path legacy domain and retains identity after migration/move',()=>{
    const root=mkdtempSync(join(tmpdir(),'profile-legacy-'));try{
      const old=join(root,'old');mkdirSync(join(old,'multi-agent'),{recursive:true});
      const legacy=createHash('sha256').update(resolve(old)).digest('hex');
      let db=new DatabaseSync(join(old,'multi-agent/groups.sqlite'));db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(legacy);db.close();
      const identity=resolveDesktopProfile(old);expect(identity.legacyProfileId).toBe(legacy);
      db=new DatabaseSync(join(old,'multi-agent/groups.sqlite'));db.prepare('UPDATE thread_bindings SET profile_id=?').run(identity.profileId);db.close();
      renameSync(old,join(root,'new'));expect(resolveDesktopProfile(join(root,'new')).profileId).toBe(identity.profileId);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('does not treat another path domain or a symlink database as legacy ownership',()=>{
    const root=mkdtempSync(join(tmpdir(),'profile-unknown-'));try{
      mkdirSync(join(root,'multi-agent'));const file=join(root,'multi-agent/groups.sqlite');
      const db=new DatabaseSync(file);db.exec("PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT);INSERT INTO thread_bindings VALUES ('other-domain')");db.close();
      expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');
      if(process.platform!=='win32'){renameSync(file,join(root,'target.sqlite'));symlinkSync(join(root,'target.sqlite'),file);expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');}
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('sees UUID and migration facts that exist only in committed WAL and will not mint a replacement identity',()=>{
    const root=mkdtempSync(join(tmpdir(),'profile-wal-'));let db:DatabaseSync|undefined;try{
      const profile=loadContinuityProfile(root);rmSync(join(root,'continuity-profile.json'));mkdirSync(join(root,'multi-agent'));
      db=new DatabaseSync(join(root,'multi-agent/groups.sqlite'));db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT);PRAGMA wal_checkpoint(TRUNCATE)');
      db.prepare('INSERT INTO thread_bindings VALUES (?)').run(profile);
      expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');
    }finally{db?.close();rmSync(root,{recursive:true,force:true});}
  });
  it('retains the verified legacy alias through realpath normalization and an inode-changing copy during a partial owner migration',()=>{
    const root=mkdtempSync(join(tmpdir(),'profile-alias-copy-'));try{
      const old=join(root,'old');mkdirSync(join(old,'multi-agent'),{recursive:true});const legacy=createHash('sha256').update(resolve(old)).digest('hex');
      const db=new DatabaseSync(join(old,'multi-agent/groups.sqlite'));db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.prepare('INSERT INTO thread_bindings VALUES (?)').run(legacy);db.close();
      const identity=resolveDesktopProfile(old);expect(resolveDesktopProfile(realpathSync(old))).toEqual(identity);
      const copy=join(root,'new');cpSync(old,copy,{recursive:true});expect(resolveDesktopProfile(copy)).toEqual(identity);
      rmSync(join(copy,'continuity-profile.json'));expect(()=>resolveDesktopProfile(copy)).toThrow('profile_identity_unavailable');
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
