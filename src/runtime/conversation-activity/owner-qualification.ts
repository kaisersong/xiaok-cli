import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {readContinuityProfile} from '../context-continuity/profile-identity.js';
import {activityOwnerConfigDigest} from './owner-config.js';
import {ACTIVITY_OWNER_GENERATION} from './owner-protocol.js';
import {ACTIVITY_STORAGE_NAMES} from './storage-permissions.js';
import type {ActivityOwnerConfig} from './owner-runtime.js';
export interface ActivityOwnerQualification {profileId:string;configDigest:string;generation:number}
function canonicalPath(path:string):string{
  let current=resolve(path);const tail:string[]=[];
  for(;;){try{return join(realpathSync(current),...tail.reverse());}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=dirname(current);if(parent===current)throw error;tail.push(basename(current));current=parent;}}
}
/** Auto-detection cannot turn a protected root with missing identity into Standalone. */
export function readProtectedOwnerQualification(root:string):ActivityOwnerQualification|undefined{
  const present=(path:string)=>{try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
  const protectedMarker=['continuity-profile.json','continuity-profile-migration.json','continuity.sqlite','multi-agent/groups.sqlite','codex-native.sqlite'].some(path=>present(join(root,path)));
  const file=join(root,ACTIVITY_STORAGE_NAMES.config);
  if(!protectedMarker&&!present(file))return undefined;
  try{
    const before=lstatSync(file);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>256*1024||typeof process.getuid==='function'&&(before.uid!==process.getuid()||(before.mode&0o077)!==0))throw new Error();
    const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let config:ActivityOwnerConfig;
    try{const opened=fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size>256*1024)throw new Error();config=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
    if(config.schemaVersion!==1)throw new Error();
    if(!protectedMarker&&config.identity?.kind==='cli')return undefined;
    const profileId=readContinuityProfile(root);
    if(config.schemaVersion!==1||config.profileId!==profileId||config.actorId!==`desktop-user:${profileId}`||realpathSync(config.dataRoot)!==realpathSync(root)||config.identity?.kind!=='desktop'||canonicalPath(config.identity.path)!==canonicalPath(join(root,'multi-agent','groups.sqlite')))throw new Error();
    return Object.freeze({profileId,configDigest:activityOwnerConfigDigest(config),generation:ACTIVITY_OWNER_GENERATION});
  }catch{throw new Error('activity_owner_qualification_unavailable');}
}
