import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface WindowsOwnerFacts {
  readonly currentSid: string; readonly ownerSid: string; readonly allowSids: readonly string[];
  readonly protected: boolean; readonly directory: boolean; readonly identity: string; readonly sddl: string;
  readonly protectionOwnerEligible: boolean;
}
type NativeSecurity = {protectDirectory(path:string):WindowsOwnerFacts;createPrivateDirectory(path:string):boolean;inspect(path:string):WindowsOwnerFacts;protectFile(path:string):WindowsOwnerFacts;processBirth(pid:number):string;writePrivateFile(path:string,content:string,exclusive:boolean):boolean};
const requireNative=createRequire(import.meta.url);
let api:NativeSecurity|undefined;
function unavailable():never {throw Error('windows_security_unavailable');}
function readFile(path:string,limit:number):Buffer {
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>limit)unavailable();
  const bytes=readFileSync(path);if(bytes.length!==stat.size)unavailable();return bytes;
}
function native():NativeSecurity {
  if(process.platform!=='win32'||process.arch!=='x64')unavailable();
  if(api)return api;
  const root=dirname(fileURLToPath(import.meta.url)).split(sep).map(part=>part==='app.asar'?'app.asar.unpacked':part).join(sep);
  const directory=join(root,'native','win32-x64'),file=join(directory,'windows_owner_security.node');
  for(const path of [join(root,'native'),directory]){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())unavailable();}
  const manifest=JSON.parse(readFile(join(directory,'windows_owner_security.json'),4096).toString('utf8'));
  const bytes=readFile(file,4*1024*1024);
  if(!manifest||Object.keys(manifest).sort().join(',')!=='napi,sha256,sourceSha256,target,version'||manifest.version!==1||manifest.napi!==8||manifest.target!=='win32-x64'||!/^[a-f0-9]{64}$/.test(manifest.sourceSha256)||manifest.sha256!==createHash('sha256').update(bytes).digest('hex'))unavailable();
  const loaded=requireNative(file) as NativeSecurity;
  const methods=['inspect','protectFile','processBirth','writePrivateFile','protectDirectory','createPrivateDirectory'] as const;
  for(const key of methods){const field=Object.getOwnPropertyDescriptor(loaded,key);if(!field||!('value'in field)||typeof field.value!=='function')unavailable();}
  api=Object.freeze({protectDirectory:loaded.protectDirectory,createPrivateDirectory:loaded.createPrivateDirectory,inspect:loaded.inspect,protectFile:loaded.protectFile,processBirth:loaded.processBirth,writePrivateFile:loaded.writePrivateFile});return api;
}
function captured(value:WindowsOwnerFacts):WindowsOwnerFacts {
  const sid=/^S-1-\d+(?:-\d+)+$/;
  if(!value||!sid.test(value.currentSid)||!sid.test(value.ownerSid)||!Array.isArray(value.allowSids)||value.allowSids.length>1024||!value.allowSids.every(item=>typeof item==='string'&&sid.test(item))||typeof value.protected!=='boolean'||typeof value.directory!=='boolean'||typeof value.protectionOwnerEligible!=='boolean'||typeof value.identity!=='string'||!/^\d+:\d+:\d+:\d+$/.test(value.identity)||typeof value.sddl!=='string'||value.sddl.length>65536)unavailable();
  return Object.freeze({...value,allowSids:Object.freeze([...value.allowSids])});
}
/** Ordinary OS metadata; never a Native authority or a caller-supplied SID proof. */
export function inspectWindowsOwnerPath(path:string):WindowsOwnerFacts {return captured(native().inspect(path));}
export function protectWindowsOwnerFile(path:string):void {
  const value=captured(native().protectFile(path));
  if(value.directory||!value.protected||!value.protectionOwnerEligible||value.allowSids.length!==1||value.allowSids[0]!==value.currentSid)unavailable();
}
export function readWindowsProcessBirth(pid:number):string {
  if(!Number.isSafeInteger(pid)||pid<1||pid>0xffffffff)unavailable();
  const result=native().processBirth(pid);if(typeof result!=='string'||!/^\d{18}$/.test(result))unavailable();return result;
}
/** The DACL is supplied to CreateFile, before any secret bytes are written. */
export function writeWindowsPrivateFile(path:string,content:string,exclusive=false):void {
  if(typeof content!=='string'||Buffer.byteLength(content)>4*1024*1024||native().writePrivateFile(path,content,exclusive)!==true)unavailable();
}
export function ensureWindowsPrivateFile(path:string):void {
  const created=native().writePrivateFile(path,'',true);
  if(created===false)protectWindowsOwnerFile(path);else if(created!==true)unavailable();
}

export function protectWindowsOwnerDirectory(path:string):void {
  const value=captured(native().protectDirectory(path));
  if(!value.directory||!value.protected||!value.protectionOwnerEligible||value.allowSids.length!==1||value.allowSids[0]!==value.currentSid)unavailable();
}
export function createWindowsPrivateDirectory(path:string):void {
  const result=native().createPrivateDirectory(path);
  if(result!==true&&result!==false)unavailable();
  protectWindowsOwnerDirectory(path);
}
