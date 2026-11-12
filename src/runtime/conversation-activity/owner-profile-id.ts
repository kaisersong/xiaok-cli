import {createHash,Hash} from 'node:crypto';
import {lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readContinuityProfile,readMigratedLegacyProfileId,desktopContinuityScopeProfileId} from '../context-continuity/profile-identity.js';
export {desktopContinuityScopeProfileId} from '../context-continuity/profile-identity.js';

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;

/** The legacy Desktop profile id: sha256 of the resolved Desktop data root.
 * 1.6.2 (and 1.6.3 before #233 UUID fix) scoped groups.sqlite profile_id and the
 * `desktop-user:<id>` actor with it, so a root whose data already carries it
 * keeps it as Main's service scope. A profile born with a continuity UUID uses
 * desktopContinuityScopeProfileId instead (desktop-service-scope.ts decides).
 * It is scope data and grants no user or resource authority. */
export function desktopActivityProfileId(dataRoot:string):string{
  const state=scopeHash('sha256');scopeApply(scopeUpdate,state,[resolve(dataRoot)]);return scopeApply(scopeDigest,state,['hex']) as string;
}
const CONTINUITY_ARTIFACTS=['continuity-profile.json','continuity-profile-migration.json','continuity.sqlite'] as const;
/** Any continuity artifact (readable or not) present in the root. */
export function hasContinuityArtifact(root:string):boolean{
  return CONTINUITY_ARTIFACTS.some(name=>{try{lstatSync(join(root,name));return true;}catch(raw){if((raw as NodeJS.ErrnoException).code==='ENOENT')return false;throw raw;}});
}
/** A Desktop owner config names its profile the way Main does: profileId is
 * recomputed from the root Main hashed. The launcher stores the realpath as
 * dataRoot, so Main also records the path it hashed as `profileRoot` (macOS
 * /var -> /private/var); that path must still resolve to the qualified root.
 * Without profileRoot the stored dataRoot is the hashed path. */
export function isDesktopActivityProfile(config:{dataRoot?:unknown;profileRoot?:unknown;profileId?:unknown;actorId?:unknown},root:string):boolean{
  const profileRoot=config.profileRoot===undefined?config.dataRoot:config.profileRoot;
  if(typeof profileRoot!=='string'||typeof config.profileId!=='string')return false;
  let real:string;try{real=realpathSync(profileRoot);}catch{return false;}
  if(real!==root||config.actorId!==`desktop-user:${config.profileId}`)return false;
  if(config.profileId===desktopActivityProfileId(profileRoot)){
    // The legacy digest is a 1.6.2 scope, never a UUID-born profile's. It is
    // accepted only for (1) a Windows 1.6.2 root continuity never adopted (no
    // continuity artifact at all; profile.ts refuses it), or (2) a macOS 1.6.2
    // root whose own migration alias records exactly this digest.
    try {
      if(process.platform==='win32'&&!hasContinuityArtifact(root))return true;
      return readMigratedLegacyProfileId(root,readContinuityProfile(root))===config.profileId;
    } catch {return false;}
  }
  // A UUID-born profile: the id must be the digest of this root's own
  // continuity profile, re-read here (never taken from the config).
  try{return config.profileId===desktopContinuityScopeProfileId(readContinuityProfile(root));}catch{return false;}
}
