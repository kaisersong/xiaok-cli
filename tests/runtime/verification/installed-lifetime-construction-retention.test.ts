import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import Native from 'better-sqlite3';
const f=vi.hoisted(()=>({root:'',mode:'key',primary:undefined as Error|undefined,cleanup:undefined as Error|undefined,publicPem:'',privatePem:'',lock:undefined as WeakRef<{assertCurrent():void;close():void}>|undefined,database:undefined as WeakRef<import('better-sqlite3').Database>|undefined}));
const installedBase='/Library/Application Support/xiaok-verification';
// Only installation/identity leaves are fixtures. All returned owner locks and
// metadata databases below use actual native SQLite and private temporary paths.
vi.mock('node:fs',async original=>{const actual=await original<typeof import('node:fs')>();return {...actual,lstatSync:(path:Parameters<typeof actual.lstatSync>[0],...args:unknown[])=>{
 const name=String(path);if(name.startsWith('/Library/Application Support/xiaok-verification/')){
  if(name.endsWith('-key.pem')){if(f.mode==='key')throw f.primary;return {isFile:()=>true,isSymbolicLink:()=>false,nlink:1,uid:process.getuid!(),mode:0o600,size:Buffer.byteLength(f.privatePem),dev:1,ino:1};}
  return {size:2};
 }
 return (actual.lstatSync as Function)(path,...args);
},readFileSync:(path:Parameters<typeof actual.readFileSync>[0],...args:unknown[])=>String(path).startsWith('/Library/Application Support/xiaok-verification/')?Buffer.from(String(path).endsWith('-key.pem')?f.privatePem:'{}'):(actual.readFileSync as Function)(path,...args)};});
vi.mock('../../../src/runtime/verification/installed-identity.js',()=>({assertRootProtectedFile(){},assertRootProtectedExecutable(){},assertInstalledControllerIdentity(){}}));
vi.mock('../../../src/runtime/verification/deployment-manifest.js',()=>({parseInstalledDeploymentManifest:()=>({packageHash:'a'.repeat(64),authorityId:'fixture-authority',serviceUid:process.getuid!(),allowedUserIds:[],publicKeyPem:f.publicPem})}));
vi.mock('../../../src/runtime/verification/deployment-package.js',()=>({parseDeploymentPackageInventory:()=>({packageHash:'a'.repeat(64)}),verifyDeploymentPackage(){}}));
vi.mock('../../../src/runtime/verification/installed-receiver-registration.js',()=>({parseInstalledReceiverRegistration:()=>({serviceUid:process.getuid!(),publicKeyPem:f.publicPem})}));
vi.mock('../../../src/runtime/verification/composite-service-registration.js',()=>({parseCompositeServicePair:()=>({egress:{serviceUid:process.getuid!(),publicKeyPem:f.publicPem},participant:{serviceUid:process.getuid!(),publicKeyPem:f.publicPem}})}));
vi.mock('../../../src/runtime/verification/controller-lifetime-lock.js',async original=>{const actual=await original<typeof import('../../../src/runtime/verification/controller-lifetime-lock.js')>();return {...actual,acquireControllerLifetimeLock:()=>{const lock=actual.acquireControllerLifetimeLock(f.root);f.lock=new WeakRef(lock);return lock;}};});
vi.mock('../../../src/runtime/verification/private-database.js',async original=>{const actual=await original<typeof import('../../../src/runtime/verification/private-database.js')>();return {...actual,openPrivateVerificationDatabase:()=>{const database=actual.openPrivateVerificationDatabase(f.root);f.database=new WeakRef(database);return database;}};});
vi.mock('../../../src/runtime/verification/storage-owner-schema.js',()=>({assertStorageOwnerSchema(){throw f.primary;}}));
import {createInstalledControllerLifetime} from '../../../src/runtime/verification/installed-controller-lifetime.js';
import {createInstalledReceiverLifetime} from '../../../src/runtime/verification/installed-receiver-lifetime.js';
import {createInstalledCompositeLifetime} from '../../../src/runtime/verification/installed-composite-lifetime.js';
const roots:string[]=[],originalClose=Native.prototype.close;
setFlagsFromString('--expose_gc');const collect=runInNewContext('gc') as ()=>void;
async function gc(){for(let i=0;i<12;i++){await nextTurn();collect();await nextTurn();}}
beforeEach(()=>{f.root=mkdtempSync(join(tmpdir(),'installed-lifetime-cleanup-'));roots.push(f.root);f.mode='key';f.primary=Error('original-construction-failure');f.cleanup=Error('native-close-failure');f.lock=undefined;f.database=undefined;const keys=generateKeyPairSync('ed25519');f.publicPem=keys.publicKey.export({format:'pem',type:'spki'}).toString();f.privatePem=keys.privateKey.export({format:'pem',type:'pkcs8'}).toString();Native.prototype.close=function(){if(f.cleanup)throw f.cleanup;return originalClose.call(this);};});
afterEach(()=>{Native.prototype.close=originalClose;f.cleanup=undefined;const database=f.database?.deref();if(database?.open)database.close();f.lock?.deref()?.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64').each(['controller','receiver','egress','participant'] as const)('retains the original %s construction error alongside a failed native lock cleanup',async kind=>{
 let error:unknown;try{if(kind==='controller')createInstalledControllerLifetime();else if(kind==='receiver')createInstalledReceiverLifetime();else createInstalledCompositeLifetime(kind);}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(f.primary);expect((error as AggregateError).errors).toEqual([f.primary,f.cleanup]);
 f.cleanup=undefined;await gc();expect(f.lock?.deref()).toBeDefined();
 const {createRequire}=await import('node:module'),Sqlite=createRequire(import.meta.url)('better-sqlite3') as typeof Native;
 const second=new Sqlite(join(f.root,'controller-owner.sqlite'),{timeout:0});try{expect(()=>second.exec('BEGIN EXCLUSIVE')).toThrow(/locked/);}finally{second.close();}
});
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('retains both actual databases when controller metadata close fails, without closing its dependent lifetime lock',async()=>{
 f.mode='schema';let error:unknown;try{createInstalledControllerLifetime();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(f.primary);expect((error as AggregateError).errors).toEqual([f.primary,f.cleanup]);
 f.cleanup=undefined;await gc();expect(f.database?.deref()?.open).toBe(true);expect(f.lock?.deref()).toBeDefined();
 const second=new Native(join(f.root,'controller-owner.sqlite'),{timeout:0});try{expect(()=>second.exec('BEGIN EXCLUSIVE')).toThrow(/locked/);}finally{second.close();}
});
