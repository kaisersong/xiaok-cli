import {createHash,Hash} from 'node:crypto';
import {resolve} from 'node:path';
import {desktopActivityProfileId} from '../../src/runtime/conversation-activity/owner-profile-id.js';

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;
function hash(value:string):string {const state=scopeHash('sha256');scopeApply(scopeUpdate,state,[value]);return scopeApply(scopeDigest,state,['hex']) as string;}

/** The existing Services IDs, shared with Main before Services is constructed.
 * `profileId` is Main's resolved profile scope (desktop-main-identity.ts);
 * without it the legacy data-root digest is used. These values are scope data
 * and grant no user or resource authority. */
export function resolveDesktopServiceScope(options:{dataRoot:string;workspaceRoot?:string;profileId?:string}):Readonly<{profileId:string;workspaceId:string;cwd:string}> {
  const cwd=resolve(options.workspaceRoot??process.cwd());
  if(options.profileId!==undefined&&(typeof options.profileId!=='string'||!/^[a-f0-9]{64}$/.test(options.profileId)))throw Error('desktop_service_scope_invalid');
  return Object.freeze({profileId:options.profileId??desktopActivityProfileId(options.dataRoot),workspaceId:hash(cwd),cwd});
}
