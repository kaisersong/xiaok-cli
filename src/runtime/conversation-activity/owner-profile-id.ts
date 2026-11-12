import {createHash,Hash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {readContinuityProfile,desktopContinuityScopeProfileId} from '../context-continuity/profile-identity.js';
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
  if(config.profileId===desktopActivityProfileId(profileRoot))return true;
  // A UUID-born profile: the id must be the digest of this root's own
  // continuity profile, re-read here (never taken from the config).
  try{return config.profileId===desktopContinuityScopeProfileId(readContinuityProfile(root));}catch{return false;}
}
