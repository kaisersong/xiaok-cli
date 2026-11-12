import {desktopActivityProfileId,desktopContinuityScopeProfileId} from '../../src/runtime/conversation-activity/owner-profile-id.js';
import {resolveDesktopProfile,type DesktopProfileIdentity} from '../../src/runtime/context-continuity/profile.js';
import {readProfileDomainCensus} from '../../src/runtime/context-continuity/profile-probe.js';
import {readCapturedProfileJson} from '../../src/runtime/context-continuity/profile-file.js';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

export interface DesktopMainIdentity {
  /** Main's service-scope profile id (groups.sqlite profile_id, desktop-user:<id>, owner config). */
  readonly profileId:string;
  /** Continuity identity, or null when continuity must degrade. */
  readonly continuity:Readonly<DesktopProfileIdentity>|null;
  /** 'unavailable': identity failed on a root without legacy data. Fail closed:
   * this run degrades and Services writes no scope row (groups, activity,
   * Native sessions, owner config, project facts). `profileId` is then only the
   * in-memory 64-hex scope the startup sources require; it is never stored. */
  readonly scope:'continuity'|'legacy'|'unavailable';
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
    const failure=describeProfileFailure(raw),legacy=legacyScopeOf(dataRoot);
    // Only a root whose data already carries the legacy digest keeps it
    // (Windows 1.6.2, refused by profile.ts). Any other failure must not mint
    // legacy rows that a later census would read as 1.6.2 data.
    if(legacy!==undefined)return Object.freeze({profileId:legacy,continuity:null,scope:'legacy',failure});
    return Object.freeze({profileId:desktopActivityProfileId(dataRoot),continuity:null,scope:'unavailable',failure});
  }
}
/** The legacy digest the root's own data already carries, by the same census;
 * undefined when the census fails or finds none (fail closed). */
function legacyScopeOf(dataRoot:string):string|undefined {
  try {
    if(!existsSync(dataRoot))return undefined;
    const {domains}=readProfileDomainCensus(dataRoot),legacy=desktopActivityProfileId(dataRoot);
    if(domains.includes(legacy))return legacy;
    if(existsSync(join(dataRoot,'continuity-profile-migration.json'))){
      const alias=readCapturedProfileJson(dataRoot,'continuity-profile-migration.json') as {legacyProfileId?:unknown}|null;
      const id=alias&&typeof alias==='object'?alias.legacyProfileId:undefined;
      if(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)&&domains.includes(id))return id;
    }
  } catch {/* census unavailable: not proven legacy */}
  return undefined;
}
