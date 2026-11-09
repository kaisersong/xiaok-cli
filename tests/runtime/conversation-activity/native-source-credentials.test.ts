import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activityOwnerAddress, createActivityOwnerCredentials } from '../../../src/runtime/conversation-activity/owner-protocol.js';
import * as native from '../../../src/runtime/conversation-activity/native-source-credentials.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(){const root=mkdtempSync(join(tmpdir(),'activity-native-source-'));roots.push(root);return activityOwnerAddress(root);}
describe('independent original activity Native-source credential',()=>{
 it('creates one stable private capability without changing original user or producer credentials',()=>{
  const address=setup();createActivityOwnerCredentials(address);const before=readFileSync(address.credentialsPath);
  const first=native.createNativeSourceCredential(address);expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect(native.createNativeSourceCredential(address)).toEqual(first);expect(native.readNativeSourceCredential(address)).toEqual(first);
  expect(readFileSync(address.credentialsPath)).toEqual(before);
 });
 it('rejects linked and nonregular credential paths without reading or replacing the linked target',()=>{
  const address=setup();const path=native.nativeSourceCredentialPath(address);const target=join(address.dataRoot,'unrelated-private');writeFileSync(target,'leave untouched',{mode:0o600});
  symlinkSync(target,path);expect(()=>native.readNativeSourceCredential(address)).toThrow(/native_source_credentials/);expect(()=>native.createNativeSourceCredential(address)).toThrow(/native_source_credentials/);
  expect(readFileSync(target,'utf8')).toBe('leave untouched');unlinkSync(path);
 });
 it('rejects malformed, foreign-root, over-budget and extra-field files without overwriting existing bytes or echoing a token',()=>{
  const address=setup();const first=native.createNativeSourceCredential(address);const path=native.nativeSourceCredentialPath(address);
  for(const bytes of ['{not-json',JSON.stringify({...first,rootHash:'foreign'}),'x'.repeat(4097),JSON.stringify({...first,unexpected:first.token})]){
   writeFileSync(path,bytes,{mode:0o600});let failure:unknown;try{native.createNativeSourceCredential(address);}catch(error){failure=error;}
   expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).not.toContain(first.token);expect(readFileSync(path,'utf8')).toBe(bytes);
  }
 });
 it.skipIf(process.platform==='win32')('refuses permissive modes and multiple links instead of tightening unrelated targets',()=>{
  const address=setup();native.createNativeSourceCredential(address);const path=native.nativeSourceCredentialPath(address);chmodSync(path,0o644);
  expect(()=>native.readNativeSourceCredential(address)).toThrow(/native_source_credentials/);chmodSync(path,0o600);const alias=join(address.dataRoot,'unrelated-hard-link');linkSync(path,alias);expect(()=>native.readNativeSourceCredential(address)).toThrow(/native_source_credentials/);unlinkSync(alias);
 });
 it.skipIf(process.platform==='win32')('creates its own private credential under a restrictive inherited umask',()=>{
  const address=setup();const previous=process.umask(0o777);
  try{native.createNativeSourceCredential(address);expect(statSync(native.nativeSourceCredentialPath(address)).mode&0o777).toBe(0o600);expect(native.readNativeSourceCredential(address).token).toMatch(/^[a-f0-9]{64}$/);}
  finally{process.umask(previous);}
 });
 it('keeps Windows capability unavailable until its private credential identity can actually be proved',()=>{
  const address=setup();const actual=process.platform;
  try{Object.defineProperty(process,'platform',{value:'win32'});expect(()=>native.createNativeSourceCredential(address)).toThrow('activity_native_source_credentials_platform_unsupported');expect(()=>native.readNativeSourceCredential(address)).toThrow('activity_native_source_credentials_platform_unsupported');}
  finally{Object.defineProperty(process,'platform',{value:actual});}
 });
});
