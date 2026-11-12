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

/** The legacy digest a macOS 1.6.2 migration recorded for this root's own
 * continuity profile; undefined without a valid alias bound to that profile. */
export function readMigratedLegacyProfileId(dataRoot:string,continuityProfileId:string):string|undefined {
  try {
    const alias=readCapturedProfileJson(dataRoot,'continuity-profile-migration.json') as {version?:unknown;profileId?:unknown;legacyProfileId?:unknown};
    if(!alias||typeof alias!=='object'||Array.isArray(alias)||alias.version!==1||alias.profileId!==continuityProfileId)return undefined;
    return typeof alias.legacyProfileId==='string'&&/^[a-f0-9]{64}$/.test(alias.legacyProfileId)?alias.legacyProfileId:undefined;
  } catch {return undefined;}
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
