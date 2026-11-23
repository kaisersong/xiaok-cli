import {it,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PluginClaimLock,PluginLockFailClosedError} from '../../../src/platform/provider-store/plugin-claim-lock.js';
import {PluginClaimLock as LegacyLock,PluginLockFailClosedError as LegacyClosed} from '../../support/legacy-plugin-claim-lock-v163.js';
const kernel=(ticks:string)=>`linux-proc-v1:550e8400-e29b-41d4-a716-446655440000:${ticks}`;
function lock(root:string,pid:number,start:string,probe:(pid:number)=>{pid:number;startIdentity:string}|null,legacy=false){const Class=legacy?LegacyLock:PluginClaimLock;return new Class({claimsDir:root,acquireTimeoutMs:50,pollIntervalMs:1,deps:{self:()=>({pid,startIdentity:start}),probeIdentity:probe,now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))}});}
it('actual 1.6.3 parser refuses a live v3 kernel claim without deleting it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'claim-upgrade-'));
 try{const current=lock(root,100,kernel('10'),pid=>({pid,startIdentity:kernel('10')}));const cap=await current.acquire();const file=readdirSync(root).find(f=>f.endsWith('.claim'))!;const before=readFileSync(join(root,file),'utf8');
 const older=lock(root,200,'old-ps',pid=>({pid,startIdentity:'old-ps'}),true);await expect(older.acquire()).rejects.toBeInstanceOf(LegacyClosed);expect(readFileSync(join(root,file),'utf8')).toBe(before);current.release(cap);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('new protocol preserves a live old claim and cleans only its own failed choosing record',async()=>{
 const root=mkdtempSync(join(tmpdir(),'claim-upgrade-'));
 try{const older=lock(root,100,'old-ps',pid=>({pid,startIdentity:'old-ps'}),true);const cap=await older.acquire();const before=readdirSync(root);
 const current=lock(root,200,kernel('20'),pid=>({pid,startIdentity:kernel(pid===100?'10':'20')}));await expect(current.acquire()).rejects.toBeInstanceOf(PluginLockFailClosedError);expect(readdirSync(root)).toEqual(before);older.release(cap);
 }finally{rmSync(root,{recursive:true,force:true});}
});
