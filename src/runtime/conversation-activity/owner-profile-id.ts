import {createHash,Hash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;

/** The Desktop profile id: sha256 of the resolved Desktop data root. This is the
 * single source for Main's service scope (groups.sqlite profile_id, the
 * `desktop-user:<id>` actor) and for what owner qualification accepts. It is
 * scope data and grants no user or resource authority. */
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
  return real===root&&config.profileId===desktopActivityProfileId(profileRoot)&&config.actorId===`desktop-user:${config.profileId}`;
}
