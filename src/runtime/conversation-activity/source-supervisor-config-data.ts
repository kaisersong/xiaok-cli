import {randomBytes} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {types} from 'node:util';
import type {ConfigScope} from './source-supervisor-types.js';
const configApply=Reflect.apply,configCharCode=String.prototype.charCodeAt,configDescriptors=Object.getOwnPropertyDescriptors,configObjectKeys=Object.keys,configOwn=Object.hasOwn,configFreeze=Object.freeze;
export function configHex(raw:unknown):raw is string{if(typeof raw!=='string'||raw.length!==64)return false;for(let i=0;i<64;i++){const n=configApply(configCharCode,raw,[i]);if(!(n>=48&&n<=57||n>=97&&n<=102))return false;}return true;}
export function configScope(raw:unknown):ConfigScope|undefined{if(!raw||typeof raw!=='object'||types.isProxy(raw))return;const rows=configDescriptors(raw),names=configObjectKeys(rows);if(names.length!==2)return;const profile=rows.profileId,workspace=rows.workspaceId;if(!profile||!workspace||!configOwn(profile,'value')||!configOwn(workspace,'value')||!configHex(profile.value)||!configHex(workspace.value))return;return configFreeze({profileId:profile.value,workspaceId:workspace.value});}
export function sameConfigScope(a:ConfigScope,b:ConfigScope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
export function configNonce(){const bytes=randomBytes(32),alphabet='0123456789abcdef';let value='';for(let i=0;i<bytes.length;i++){const byte=bytes[i]!;value+=alphabet[byte>>>4]!+alphabet[byte&15]!;}return value;}
export function configPathSame(left:string,right:string){try{return realpathSync.native(left)===realpathSync.native(right);}catch{return false;}}
