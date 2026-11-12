import {createHash,Hash} from 'node:crypto';
import {resolve} from 'node:path';

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;

/** The Desktop profile id: sha256 of the resolved Desktop data root. This is the
 * single source for Main's service scope (groups.sqlite profile_id, the
 * `desktop-user:<id>` actor) and for what owner qualification accepts. It is
 * scope data and grants no user or resource authority. */
export function desktopActivityProfileId(dataRoot:string):string{
  const state=scopeHash('sha256');scopeApply(scopeUpdate,state,[resolve(dataRoot)]);return scopeApply(scopeDigest,state,['hex']) as string;
}
/** A Desktop owner config names its profile the way Main does. The launcher
 * stores the realpath of the data root, so a root reached through a symlink
 * (macOS /var -> /private/var) cannot be re-hashed here; the id is accepted by
 * shape and by its actor binding, and the attaching launcher still requires
 * the owner's status profileId to equal Main's own. */
export function isDesktopActivityProfile(config:{profileId?:unknown;actorId?:unknown}):boolean{
  return typeof config.profileId==='string'&&/^[a-f0-9]{64}$/.test(config.profileId)&&config.actorId===`desktop-user:${config.profileId}`;
}
