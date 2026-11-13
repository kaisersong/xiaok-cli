import {userInfo} from 'node:os';
import {createHash,Hash} from 'node:crypto';
import {readCapturedProfileJson} from './profile-file.js';

/** Read-only consumers never initialize identity or create a missing directory. */
export function readContinuityProfile(dataRoot:string):string {
  const info=userInfo(),osOwner=process.platform==='win32'?info.username:String(info.uid);
  try {
    const record=readCapturedProfileJson(dataRoot,'continuity-profile.json') as {version?:unknown;profileId?:unknown;osOwner?:unknown};
    if(!record||typeof record!=='object'||Array.isArray(record)||!['version','profileId','osOwner'].every(key=>Object.hasOwn(record,key)))throw Error();
    if(record?.version!==1||record.osOwner!==osOwner||typeof record.profileId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.profileId))throw Error();
    return record.profileId;
  } catch {throw Error('profile_identity_unavailable');}
}

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;
/** Main's service-scope id for a profile born with a continuity UUID. Scope
 * consumers (DSH, writer control, KSwarm, dispatch) require 64 hex chars, so the
 * UUID is carried as a domain-separated digest. It is bound to the persisted
 * continuity profile, so a moved data root keeps its scope; it grants no
 * authority by itself. */
export function desktopContinuityScopeProfileId(continuityProfileId:string):string {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(continuityProfileId))throw Error('profile_identity_unavailable');
  const state=scopeHash('sha256');scopeApply(scopeUpdate,state,['xiaok-desktop-service-scope-v1\0'+continuityProfileId]);return scopeApply(scopeDigest,state,['hex']) as string;
}
