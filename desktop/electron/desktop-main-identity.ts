import {desktopActivityProfileId,desktopContinuityScopeProfileId} from '../../src/runtime/conversation-activity/owner-profile-id.js';
import {resolveDesktopProfile,type DesktopProfileIdentity} from '../../src/runtime/context-continuity/profile.js';

export interface DesktopMainIdentity {
  /** Main's service-scope profile id (groups.sqlite profile_id, desktop-user:<id>, owner config). */
  readonly profileId:string;
  /** Continuity identity, or null when continuity must degrade. */
  readonly continuity:Readonly<DesktopProfileIdentity>|null;
  readonly scope:'continuity'|'legacy';
  /** Inner reason when continuity identity was refused (main-debug.log evidence). */
  readonly failure?:string;
}
export function describeProfileFailure(raw:unknown):string {
  const message=raw instanceof Error?raw.message||'(no message)':String(raw);
  const cause=raw instanceof Error?raw.cause:undefined;
  if(cause===undefined)return message;
  const frame=cause instanceof Error?(cause.stack??'').split('\n').slice(1).map(line=>line.trim()).find(line=>line.startsWith('at ')):undefined;
  return `${message} (cause: ${cause instanceof Error?cause.message||'(no message)':String(cause)}${frame?` ${frame}`:''})`;
}
/** Resolve once in Main, before Services writes any scope row, and hand the
 * same value to Services. A profile whose data already carries the legacy
 * data-root digest keeps it (1.6.2 rows are never rewritten): on macOS
 * continuity migrates it, on Windows continuity refuses adoption
 * (profile.ts) and degrades while groups/authorizations stay visible under the
 * legacy scope. Every other profile is scoped by its continuity UUID. */
export function resolveDesktopMainIdentity(dataRoot:string):DesktopMainIdentity {
  try {
    const continuity=Object.freeze({...resolveDesktopProfile(dataRoot)});
    if(continuity.legacyProfileId!==undefined)return Object.freeze({profileId:continuity.legacyProfileId,continuity,scope:'legacy'});
    return Object.freeze({profileId:desktopContinuityScopeProfileId(continuity.profileId),continuity,scope:'continuity'});
  } catch(raw) {
    return Object.freeze({profileId:desktopActivityProfileId(dataRoot),continuity:null,scope:'legacy',failure:describeProfileFailure(raw)});
  }
}
