import {userInfo} from 'node:os';
import {readCapturedProfileJson} from './profile-file.js';
import {readWindowsLegacyProfileAlias} from './windows-profile.js';
/** Owned metadata mapping, never an execution/source admission grant. */
export function readDesktopLegacyProfileAlias(root:string,profileId:string):string|undefined {
 if(process.platform==='win32')return readWindowsLegacyProfileAlias(root,profileId);
 try{
  const raw=readCapturedProfileJson(root,'continuity-profile-migration.json') as {version?:unknown;profileId?:unknown;legacyProfileId?:unknown;osOwner?:unknown};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='legacyProfileId,osOwner,profileId,version'||raw.version!==1||raw.profileId!==profileId||raw.osOwner!==String(userInfo().uid)||typeof raw.legacyProfileId!=='string'||!/^[a-f0-9]{64}$/.test(raw.legacyProfileId))throw Error('profile_identity_unavailable');
  return raw.legacyProfileId;
 }catch(raw){if((raw as NodeJS.ErrnoException).code==='ENOENT')return;throw raw;}
}
