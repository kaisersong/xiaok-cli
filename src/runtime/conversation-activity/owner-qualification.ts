import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync,type BigIntStats} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {readContinuityProfile} from '../context-continuity/profile-identity.js';
import {isDesktopActivityProfile} from './owner-profile-id.js';
import {assertProfileDirectory} from '../context-continuity/profile-file.js';
import {activityOwnerConfigDigest} from './owner-config.js';
import {ACTIVITY_OWNER_GENERATION} from './owner-protocol.js';
import {ACTIVITY_STORAGE_NAMES} from './storage-permissions.js';
import type {ActivityOwnerConfig} from './owner-runtime.js';

/** Routing expectations only. These values never grant a Source/Native read. */
export interface ActivityOwnerQualification{readonly profileId:string;readonly configDigest:string;readonly generation:number}
const unknown=new Map<string,Array<{fd:number;raw:unknown}>>();
function retain(root:string,fd:number,raw:unknown){const held=unknown.get(root)??[];held.push({fd,raw});unknown.set(root,held);}
const stable=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const unavailable=()=>Error('activity_owner_qualification_unavailable');
function canonicalRoutingPath(path:string):string{let current=resolve(path);const tail:string[]=[];for(;;){try{return join(realpathSync(current),...tail.reverse());}catch(raw){if((raw as NodeJS.ErrnoException).code!=='ENOENT')throw raw;const parent=dirname(current);if(parent===current)throw raw;tail.push(basename(current));current=parent;}}}
function present(path:string):boolean{try{lstatSync(path);return true;}catch(raw){if((raw as NodeJS.ErrnoException).code==='ENOENT')return false;throw raw;}}
export function hasCanonicalActivityProfile(root:string):boolean{return ['continuity-profile.json','continuity-profile-migration.json','continuity.sqlite'].some(name=>present(join(root,name)));}
function readConfig(root:string):ActivityOwnerConfig{
 if(unknown.has(root))throw unavailable();const parent=assertProfileDirectory(root),path=join(root,ACTIVITY_STORAGE_NAMES.config),before=lstatSync(path,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>262144n||typeof process.getuid==='function'&&(before.uid!==BigInt(process.getuid())||(before.mode&0o077n)!==0n))throw unavailable();
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));let first:{raw:unknown}|undefined,value:ActivityOwnerConfig|undefined;
 const check=(binding:BigIntStats)=>{
  const now=lstatSync(path,{bigint:true});if(!stable(before,now))throw unavailable();
  if(process.platform==='win32'&&now.dev===0n){const probe=openSync(path,constants.O_RDONLY);let cause:{raw:unknown}|undefined;try{if(!stable(binding,fstatSync(probe,{bigint:true})))throw unavailable();}catch(raw){cause={raw};}try{closeSync(probe);}catch(raw){retain(root,probe,raw);if(!cause)cause={raw};}if(cause)throw cause.raw;}
 };
 try{
  const binding=fstatSync(fd,{bigint:true});
  if(!(before.dev===binding.dev||process.platform==='win32'&&before.dev===0n)||before.ino!==binding.ino||before.mode!==binding.mode||before.uid!==binding.uid||before.nlink!==binding.nlink||before.size!==binding.size||before.mtimeNs!==binding.mtimeNs||before.ctimeNs!==binding.ctimeNs)throw unavailable();
  check(binding);const bytes=Buffer.alloc(262145);let count=0;
  while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,count);if(!Number.isSafeInteger(n)||n<0||n>bytes.length-count)throw unavailable();if(!n)break;count+=n;}
  if(count!==Number(before.size)||!stable(binding,fstatSync(fd,{bigint:true})))throw unavailable();check(binding);
  const after=assertProfileDirectory(root);if(parent.dev!==after.dev||parent.ino!==after.ino||parent.uid!==after.uid||parent.mode!==after.mode)throw unavailable();
  value=JSON.parse(bytes.subarray(0,count).toString('utf8')) as ActivityOwnerConfig;
 }catch(raw){first={raw};}
 try{closeSync(fd);}catch(raw){retain(root,fd,raw);if(!first)first={raw};}
 if(first)throw first.raw;if(!value)throw unavailable();return value;
}
export function readProtectedOwnerQualification(root:string):ActivityOwnerQualification|undefined{
 root=realpathSync(root);const protectedRoot=hasCanonicalActivityProfile(root)||['multi-agent/groups.sqlite','codex-native.sqlite'].some(name=>present(join(root,name))),configPresent=present(join(root,ACTIVITY_STORAGE_NAMES.config));
 if(!protectedRoot&&!configPresent)return undefined;if(!configPresent)throw unavailable();
 const config=readConfig(root);if(config.schemaVersion!==1)throw unavailable();
 if(!protectedRoot&&config.identity?.kind==='cli')return undefined;
 // Main writes the Desktop service-scope profile id (sha256 of its data root),
 // not the continuity-profile.json UUID; requiring the UUID failed every start.
 // A Desktop root still needs its continuity profile (authority files lost ->
 // unavailable), but the owner config is bound to Main's id, checked below.
 try{readContinuityProfile(root);}catch{throw unavailable();}
 if(!isDesktopActivityProfile(config,root)||typeof config.dataRoot!=='string'||realpathSync(config.dataRoot)!==root||config.identity?.kind!=='desktop'||canonicalRoutingPath(config.identity.path)!==join(root,'multi-agent','groups.sqlite'))throw unavailable();
 return Object.freeze({profileId:config.profileId,configDigest:activityOwnerConfigDigest(config),generation:ACTIVITY_OWNER_GENERATION});
}
