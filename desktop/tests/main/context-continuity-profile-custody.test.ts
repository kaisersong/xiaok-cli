// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {chmodSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {loadContinuityProfile,resolveDesktopProfile} from '../../../src/runtime/context-continuity/profile.js';
import {readContinuityProfile} from '../../../src/runtime/context-continuity/profile-identity.js';
import {readProfileDomainCensus} from '../../../src/runtime/context-continuity/profile-probe.js';

const hooks=vi.hoisted(()=>({beforeOpen:undefined as undefined|((path:unknown)=>void),afterOpen:undefined as undefined|((path:unknown,fd:number)=>void),beforeRead:undefined as undefined|((fd:number)=>void),afterSpawn:undefined as undefined|((result:unknown)=>unknown),afterRemove:undefined as undefined|((path:unknown)=>void),probeDirectories:[] as string[]}));
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>();
  return {...actual,openSync:(...args:unknown[])=>{hooks.beforeOpen?.(args[0]);const fd=Reflect.apply(actual.openSync,actual,args) as number;hooks.afterOpen?.(args[0],fd);return fd;},readSync:(...args:unknown[])=>{hooks.beforeRead?.(args[0] as number);return Reflect.apply(actual.readSync,actual,args);},mkdtempSync:(...args:unknown[])=>{const result=Reflect.apply(actual.mkdtempSync,actual,args) as string;if(String(args[0]).endsWith('xiaok-profile-census-'))hooks.probeDirectories.push(result);return result;},rmSync:(...args:unknown[])=>{const result=Reflect.apply(actual.rmSync,actual,args);hooks.afterRemove?.(args[0]);return result;}};
});
vi.mock('node:child_process',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:child_process')>();
  return {...actual,spawnSync:(...args:unknown[])=>{const result=Reflect.apply(actual.spawnSync,actual,args);return hooks.afterSpawn?hooks.afterSpawn(result):result;}};
});
const roots:string[]=[];
function root(){const value=mkdtempSync(join(tmpdir(),'continuity-profile-custody-'));roots.push(value);return value;}
afterEach(()=>{hooks.beforeOpen=undefined;hooks.afterOpen=undefined;hooks.beforeRead=undefined;hooks.afterSpawn=undefined;hooks.afterRemove=undefined;for(const value of [...roots.splice(0),...hooks.probeDirectories.splice(0)])rmSync(value,{recursive:true,force:true,maxRetries:3});});

it('readonly missing identity never creates an identity or directory contents',()=>{
  const value=root();expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');expect(readdirSync(value)).toEqual([]);
});
it('rejects non-string persisted legacy alias values without coercing them into scope IDs',()=>{
  const value=root(),profileId=loadContinuityProfile(value),alias=join(value,'continuity-profile-migration.json');
  writeFileSync(alias,JSON.stringify({version:1,profileId,legacyProfileId:['a'.repeat(64)],osOwner:String(userInfo().uid)}),{mode:0o600});
  expect(()=>resolveDesktopProfile(value)).toThrow('profile_identity_unavailable');expect(readContinuityProfile(value)).toBe(profileId);
},12000);
it.runIf(process.platform==='win32')('never treats a manually supplied alias as Windows legacy SID proof',()=>{
  const value=root(),profileId=loadContinuityProfile(value),alias=join(value,'continuity-profile-migration.json');
  writeFileSync(alias,JSON.stringify({version:1,profileId,legacyProfileId:'a'.repeat(64),osOwner:String(userInfo().uid)}),{mode:0o600});
  expect(()=>resolveDesktopProfile(value)).toThrow('profile_identity_unavailable');expect(readContinuityProfile(value)).toBe(profileId);
},12000);
it('rejects a replaced identity between original lstat and actual open',()=>{
  const value=root();loadContinuityProfile(value);const file=join(value,'continuity-profile.json'),original=readFileSync(file);let replaced=false;
  hooks.beforeOpen=path=>{if(path===file&&!replaced){replaced=true;renameSync(file,file+'.held');writeFileSync(file,original);}};
  expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');expect(replaced).toBe(true);
});
it('rejects replacement after the held identity FD was opened',()=>{
  const value=root();loadContinuityProfile(value);const file=join(value,'continuity-profile.json'),original=readFileSync(file);let fd=-1,replaced=false;
  hooks.afterOpen=(path,opened)=>{if(path===file&&fd===-1)fd=opened;};
  hooks.beforeRead=opened=>{if(opened===fd&&!replaced){replaced=true;renameSync(file,file+'.held');writeFileSync(file,original);}};
  expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');expect(replaced).toBe(true);
});
it('bounds bytes even if the original identity file grows after its FD is captured',()=>{
  const value=root();loadContinuityProfile(value);const file=join(value,'continuity-profile.json'),original=readFileSync(file);let fd=-1,grew=false;
  hooks.afterOpen=(path,opened)=>{if(path===file&&fd===-1)fd=opened;};
  hooks.beforeRead=opened=>{if(opened===fd&&!grew){grew=true;writeFileSync(file,Buffer.concat([original,Buffer.alloc(8192,32)]));}};
  expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');expect(grew).toBe(true);
});
it('refuses hard-linked identity bytes rather than adopting an external link',()=>{
  const value=root();loadContinuityProfile(value);const file=join(value,'continuity-profile.json');linkSync(file,join(value,'other-link'));
  expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');
});
it.skipIf(process.platform==='win32')('rejects a group-writable POSIX identity without changing its permissions',()=>{
  const value=root();loadContinuityProfile(value);const file=join(value,'continuity-profile.json');chmodSync(file,0o660);
  expect(()=>readContinuityProfile(value)).toThrow('profile_identity_unavailable');expect(lstatSync(file).mode&0o777).toBe(0o660);
});
it.skipIf(process.platform==='win32')('rejects a group-writable POSIX owner database without repairing it',()=>{
  const value=root();mkdirSync(join(value,'multi-agent'));const file=join(value,'multi-agent/groups.sqlite'),db=new DatabaseSync(file);
  db.exec('PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT)');db.close();chmodSync(file,0o660);
  expect(()=>readProfileDomainCensus(value)).toThrow('profile_identity_unavailable');expect(lstatSync(file).mode&0o777).toBe(0o660);
});
it('rejects a redirected profile directory before creating identity files',()=>{
  const value=root(),target=join(value,'target'),redirect=join(value,'redirect');mkdirSync(target);symlinkSync(target,redirect,process.platform==='win32'?'junction':'dir');
  expect(()=>loadContinuityProfile(redirect)).toThrow('profile_identity_unavailable');expect(readdirSync(target)).toEqual([]);unlinkSync(redirect);
});
it('retains a bare undefined SDK failure and blocks further resource allocation',async()=>{
  vi.resetModules();const {readProfileDomainCensus:freshCensus}=await import('../../../src/runtime/context-continuity/profile-probe.js');
  const value=root();let returned=false,rejected=false,error:unknown='not-rejected',calls=0;
  hooks.afterSpawn=result=>{expect((result as {status:number}).status).toBe(0);returned=true;calls++;throw undefined;};
  try{freshCensus(value);}catch(caught){rejected=true;error=caught;}
  expect(returned).toBe(true);expect(rejected).toBe(true);expect(error).toBeUndefined();
  // The caller never received the return acknowledgement and retains the
  // directory. This fixture independently observed the real child exit above.
  expect(hooks.probeDirectories).toHaveLength(1);expect(existsSync(hooks.probeDirectories[0])).toBe(true);
  expect(()=>freshCensus(value)).toThrow('profile_identity_unavailable');expect(calls).toBe(1);expect(hooks.probeDirectories).toHaveLength(1);
},12000);
it('preserves primary parse failure and allocation seal when actual removal then throws undefined',async()=>{
  vi.resetModules();const {readProfileDomainCensus:freshCensus}=await import('../../../src/runtime/context-continuity/profile-probe.js');
  const value=root();let removed=false;
  hooks.afterSpawn=result=>({...result as object,stdout:'{'});
  hooks.afterRemove=path=>{if(hooks.probeDirectories.includes(String(path))){removed=true;throw undefined;}};
  expect(()=>freshCensus(value)).toThrow(SyntaxError);expect(removed).toBe(true);
  expect(existsSync(hooks.probeDirectories[0])).toBe(false);
  expect(()=>freshCensus(value)).toThrow('profile_identity_unavailable');expect(hooks.probeDirectories).toHaveLength(1);
},12000);
it('reads real committed WAL in a child without releasing the original parent writer lock',()=>{
  const value=root();mkdirSync(join(value,'multi-agent'));const file=join(value,'multi-agent/groups.sqlite'),db=new DatabaseSync(file),domain=randomUUID();
  try{
    db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT);PRAGMA wal_checkpoint(TRUNCATE)');
    db.prepare('INSERT INTO thread_bindings VALUES (?)').run(domain);
    const wal=readFileSync(file+'-wal');expect(wal.length).toBeGreaterThan(32);db.exec('BEGIN IMMEDIATE');
    expect(readProfileDomainCensus(value)).toEqual({domains:[domain],migrated:false});
    const observer=new DatabaseSync(file);try{expect(()=>observer.exec('BEGIN IMMEDIATE')).toThrow(/locked/);}finally{observer.close();}
    expect(readFileSync(file+'-wal')).toEqual(wal);db.exec('ROLLBACK');
  }finally{db.close();}
},12000);
it.each(['checksum','salt','truncated','garbage'] as const)('denies %s WAL without minting identity from an older legacy-only commit',mode=>{
  const value=root();mkdirSync(join(value,'multi-agent'));const file=join(value,'multi-agent/groups.sqlite'),db=new DatabaseSync(file);let original:Buffer|undefined;
  try{
    db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA user_version=4;CREATE TABLE thread_bindings(profile_id TEXT);PRAGMA wal_checkpoint(TRUNCATE)');
    db.prepare('INSERT INTO thread_bindings VALUES (?)').run(createHash('sha256').update(resolve(value)).digest('hex'));
    db.prepare('INSERT INTO thread_bindings VALUES (?)').run(randomUUID());
    original=readFileSync(file+'-wal');const damaged=Buffer.from(original),page=original.readUInt32BE(8),last=32+Math.floor((original.length-32)/(24+page)-1)*(24+page);
    if(mode==='checksum')damaged[last+16]^=1;
    if(mode==='salt')damaged[last+8]^=1;
    const bytes=mode==='truncated'?damaged.subarray(0,damaged.length-1):mode==='garbage'?Buffer.concat([damaged,Buffer.from([1])]):damaged;
    writeFileSync(file+'-wal',bytes);
    expect(()=>readProfileDomainCensus(value)).toThrow('profile_identity_unavailable');
    expect(()=>resolveDesktopProfile(value)).toThrow('profile_identity_unavailable');
    expect(existsSync(join(value,'continuity-profile.json'))).toBe(false);expect(readFileSync(file+'-wal')).toEqual(bytes);
  }finally{if(original)writeFileSync(file+'-wal',original);db.close();}
},12000);
