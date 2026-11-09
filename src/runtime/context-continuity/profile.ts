import {readContinuityProfile} from './profile-identity.js';
export {readContinuityProfile} from './profile-identity.js';
import {assertProfileDirectory,readCapturedProfileJson} from './profile-file.js';
import {readProfileDomainCensus} from './profile-probe.js';
import {closeSync,constants,existsSync,fsyncSync,mkdirSync,openSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {userInfo} from 'node:os';

/** Persisted legacy mapping is metadata, never current admission authority. */
export interface DesktopProfileIdentity {profileId:string;legacyProfileId?:string}
/** Identity metadata only. Main must serialize initialization before owners
 * start/migrate; this census never enrolls a Native/source or proves NoEscape. */
export function resolveDesktopProfile(dataRoot:string):DesktopProfileIdentity {
  const legacy=createHash('sha256').update(resolve(dataRoot)).digest('hex'),aliasFile=join(dataRoot,'continuity-profile-migration.json');
  try {
    const existing=existsSync(dataRoot);if(existing)assertProfileDirectory(dataRoot);
    const {domains:values,migrated}=existing?readProfileDomainCensus(dataRoot):{domains:[],migrated:false},domains=new Set(values);
    let alias:{version:number;profileId:string;legacyProfileId:string;osOwner:string}|undefined;
    if(existsSync(aliasFile)){
      alias=readCapturedProfileJson(dataRoot,'continuity-profile-migration.json') as typeof alias;
      if(!alias||typeof alias!=='object'||Array.isArray(alias)||!['version','profileId','legacyProfileId','osOwner'].every(key=>Object.hasOwn(alias!,key)))throw Error();
      if(alias.version!==1||typeof alias.profileId!=='string'||typeof alias.legacyProfileId!=='string'||typeof alias.osOwner!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(alias.profileId)||!/^[a-f0-9]{64}$/.test(alias.legacyProfileId)||alias.osOwner!==String(userInfo().uid))throw Error();
    }
    const legacyProfileId=alias?.legacyProfileId??legacy;
    const requireExisting=Boolean(alias)||migrated||existsSync(join(dataRoot,'continuity.sqlite'))||[...domains].some(id=>id!==legacyProfileId);
    // Username equality is never SID/ACL proof for legacy adoption.
    if(process.platform==='win32'&&(alias!==undefined||domains.has(legacyProfileId)))throw Error();
    const profileId=loadContinuityProfile(dataRoot,{requireExisting});
    if(alias&&alias.profileId!==profileId||[...domains].some(id=>id!==legacyProfileId&&id!==profileId))throw Error();
    if(!alias&&domains.has(legacy)){
      const fd=openSync(aliasFile,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
      try{writeFileSync(fd,JSON.stringify({version:1,profileId,legacyProfileId:legacy,osOwner:String(userInfo().uid)}));fsyncSync(fd);}finally{closeSync(fd);}
    }
    return {profileId,...(alias!==undefined||domains.has(legacyProfileId)?{legacyProfileId}:{})};
  } catch {throw Error('profile_identity_unavailable');}
}

/** A moved data root retains identity. Corruption never triggers adoption. */
export function loadContinuityProfile(dataRoot:string,options?:{requireExisting?:boolean}):string {
  mkdirSync(dataRoot,{recursive:true,mode:0o700});assertProfileDirectory(dataRoot);
  const file=join(dataRoot,'continuity-profile.json'),info=userInfo(),osOwner=process.platform==='win32'?info.username:String(info.uid);
  if(!options?.requireExisting)try {
    const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
    try{writeFileSync(fd,JSON.stringify({version:1,profileId:randomUUID(),osOwner}));fsyncSync(fd);}finally{closeSync(fd);}
  } catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw Error('profile_identity_unavailable');}
  return readContinuityProfile(dataRoot);
}
