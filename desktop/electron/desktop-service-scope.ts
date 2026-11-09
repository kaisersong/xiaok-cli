import {createHash,Hash} from 'node:crypto';
import {resolve} from 'node:path';

const scopeHash=createHash,scopeUpdate=Hash.prototype.update,scopeDigest=Hash.prototype.digest,scopeApply=Reflect.apply;
function hash(value:string):string {const state=scopeHash('sha256');scopeApply(scopeUpdate,state,[value]);return scopeApply(scopeDigest,state,['hex']) as string;}

/** The existing Services IDs, shared with Main before Services is constructed.
 * These values are scope data and grant no user or resource authority. */
export function resolveDesktopServiceScope(options:{dataRoot:string;workspaceRoot?:string}):Readonly<{profileId:string;workspaceId:string;cwd:string}> {
  const cwd=resolve(options.workspaceRoot??process.cwd());
  return Object.freeze({profileId:hash(resolve(options.dataRoot)),workspaceId:hash(cwd),cwd});
}
