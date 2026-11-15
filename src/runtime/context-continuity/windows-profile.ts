import {existsSync,lstatSync,unlinkSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createExclusiveWindowsPrivateDirectory,holdWindowsProfile,publishWindowsProfileFile,writeWindowsPrivateFile,type WindowsProfileCustody} from '../windows-owner-security.js';
import {readCapturedProfileJson} from './profile-file.js';
import {readProfileDomainCensus} from './profile-probe.js';
import {desktopContinuityScopeProfileId} from './profile-identity.js';
import type {DesktopProfileIdentity} from './profile.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const PROFILE='continuity-profile.json',ALIAS='continuity-profile-migration.json';
const unavailable=()=>Error('profile_identity_unavailable');
function canonicalRoot(root:string):string {root=resolve(root);const state=lstatSync(root);if(!state.isDirectory()||state.isSymbolicLink())throw unavailable();return realpathSync(root);}
interface Profile {version:2;profileId:string;osOwnerSid:string}
interface Alias extends Profile {legacyProfileId:string}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function decodeProfile(root:string,sid:string):string {
 const raw=readCapturedProfileJson(root,PROFILE);
 if(!object(raw)||typeof raw.profileId!=='string'||!UUID.test(raw.profileId))throw unavailable();
 const keys=Object.keys(raw).sort().join(',');
 if(raw.version===2&&keys==='osOwnerSid,profileId,version'&&raw.osOwnerSid===sid)return raw.profileId;
 // A v1 username is metadata only. The held root/file handles, not that name,
 // prove current SID ownership and absence of other ordinary-account access.
 if(raw.version===1&&keys==='osOwner,profileId,version'&&typeof raw.osOwner==='string'&&raw.osOwner.length>0)return raw.profileId;
 throw unavailable();
}
function decodeAlias(root:string,sid:string):Alias|undefined {
 if(!existsSync(join(root,ALIAS)))return;
 const raw=readCapturedProfileJson(root,ALIAS);
 if(!object(raw)||Object.keys(raw).sort().join(',')!=='legacyProfileId,osOwnerSid,profileId,version'||raw.version!==2||raw.osOwnerSid!==sid||typeof raw.profileId!=='string'||!UUID.test(raw.profileId)||typeof raw.legacyProfileId!=='string'||!HEX.test(raw.legacyProfileId))throw unavailable();
 return raw as unknown as Alias;
}
function createRoot(root:string):void {
 const missing:string[]=[];
 for(let path=root;;path=dirname(path)){
  try{const state=lstatSync(path);if(!state.isDirectory()||state.isSymbolicLink())throw unavailable();break;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(dirname(path)===path)throw unavailable();
  missing.push(path);
 }
 for(const path of missing.reverse())createExclusiveWindowsPrivateDirectory(path);
}
function publish(root:string,name:typeof PROFILE|typeof ALIAS,value:Profile|Alias):void {
 const temporary=join(root,`.${name}.${randomUUID()}.tmp`);
 writeWindowsPrivateFile(temporary,JSON.stringify(value),true);
 let failure:{raw:unknown}|undefined;
 try{publishWindowsProfileFile(temporary,join(root,name));}catch(raw){failure={raw};}
 try{unlinkSync(temporary);}catch(raw){if((raw as NodeJS.ErrnoException).code!=='ENOENT'){if(failure)throw new AggregateError([failure.raw,raw],'profile_publication_cleanup_failed');throw raw;}}
 if(failure)throw failure.raw;
}
function checked<T>(lease:WindowsProfileCustody,run:()=>T):T {
 try{lease.assertCurrent();const value=run();lease.assertCurrent();return value;}
 finally{lease.close();}
}
/** Read-only consumers neither initialize identity nor touch a database/lock. */
export function readWindowsContinuityProfile(root:string):string {
 try{root=canonicalRoot(root);const lease=holdWindowsProfile(root);return checked(lease,()=>decodeProfile(root,lease.currentSid));}catch(raw){throw Error('profile_identity_unavailable',{cause:raw});}
}
/** A mapping is accepted only with SID-qualified metadata and the same UUID. */
export function readWindowsLegacyProfileAlias(root:string,profileId:string):string|undefined {
 root=canonicalRoot(root);const lease=holdWindowsProfile(root);
 return checked(lease,()=>{if(decodeProfile(root,lease.currentSid)!==profileId)throw unavailable();const alias=decodeAlias(root,lease.currentSid);if(alias&&alias.profileId!==profileId)throw unavailable();return alias?.legacyProfileId;});
}
export function resolveWindowsDesktopProfile(dataRoot:string,options:{requireExisting?:boolean}={}):DesktopProfileIdentity {
 const logicalRoot=resolve(dataRoot);
 try {
  createRoot(logicalRoot);
  const root=canonicalRoot(logicalRoot);
  const observing=existsSync(join(root,PROFILE));
  const lease=holdWindowsProfile(root,!observing,observing);
  return checked(lease,()=>{
   const census=readProfileDomainCensus(root),domains=new Set(census.domains);
   const legacy=createHash('sha256').update(logicalRoot).digest('hex');
   let alias=decodeAlias(root,lease.currentSid);
   const existed=existsSync(join(root,PROFILE));
   if(observing&&!existed)throw unavailable();
   let profileId=existed?decodeProfile(root,lease.currentSid):alias?.profileId;
   // A UUID-born installation never acquires this path's old digest by accident.
   if(!alias&&existed&&domains.has(legacy))throw unavailable();
   const legacyProfileId=alias?.legacyProfileId??legacy;
   const requireExisting=options.requireExisting||census.migrated||existsSync(join(root,'continuity.sqlite'))||[...domains].some(id=>id!==legacyProfileId);
   if(!profileId){if(requireExisting)throw unavailable();profileId=randomUUID();}
   if(alias&&alias.profileId!==profileId)throw unavailable();
   const ownScope=desktopContinuityScopeProfileId(profileId);
   if([...domains].some(id=>id!==legacyProfileId&&id!==profileId&&id!==ownScope))throw unavailable();
   if(!existed&&options.requireExisting)throw unavailable();
   lease.assertCurrent();
   if(!alias&&domains.has(legacy)){
    alias={version:2,profileId,legacyProfileId:legacy,osOwnerSid:lease.currentSid};
    publish(root,ALIAS,alias);
   }
   if(!existed)publish(root,PROFILE,{version:2,profileId,osOwnerSid:lease.currentSid});
   lease.assertCurrent();
   const metadata=holdWindowsProfile(root);
   checked(metadata,()=>{if(metadata.currentSid!==lease.currentSid||decodeProfile(root,metadata.currentSid)!==profileId)throw unavailable();const finalAlias=decodeAlias(root,metadata.currentSid);if(alias&&(!finalAlias||finalAlias.profileId!==profileId||finalAlias.legacyProfileId!==alias.legacyProfileId))throw unavailable();});
   return {profileId,...(alias?{legacyProfileId:alias.legacyProfileId}:{})};
  });
 }catch(raw){throw Error('profile_identity_unavailable',{cause:raw});}
}

/** Narrow legacy routing exception only; it never creates a mapping or identity. */
export function hasWindowsLegacyProfile(root:string,expectedLegacy:string,profileRoot=root):boolean {
 try {
  root=canonicalRoot(root);
  if(canonicalRoot(profileRoot)!==root||createHash('sha256').update(resolve(profileRoot)).digest('hex')!==expectedLegacy)return false;
  const lease=holdWindowsProfile(root,false,true);
  return checked(lease,()=>{
   if([PROFILE,ALIAS,'continuity.sqlite'].some(name=>existsSync(join(root,name))))return false;
   const census=readProfileDomainCensus(root);
   return !census.migrated&&census.domains.length>0&&census.domains.every(id=>id===expectedLegacy);
  });
 }catch{return false;}
}
