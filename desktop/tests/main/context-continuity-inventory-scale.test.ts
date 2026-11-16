// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {retainSourceErrorTails} from '../../../src/runtime/verification/source-error-tails.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
const snapshot=(id:string):TaskSnapshot=>({taskId:id,sessionId:`epoch_${id}`,status:'completed',prompt:'fixture',materials:[],events:Array.from({length:60},()=>({type:'fixture',data:{message:'preserved'}})),createdAt:1,updatedAt:2}) as unknown as TaskSnapshot;
it('audits 2021 complete snapshots individually while the same aggregate exceeds stock custody bounds',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inventory-scale-')),runtime=new DesktopContextContinuity(root),rows=Array.from({length:2021},(_,i)=>snapshot(`task_${i}`));
 try{let aggregateUnknown=0;retainSourceErrorTails(rows,()=>{aggregateUnknown++});expect(aggregateUnknown).toBeGreaterThan(0);for(const row of rows){let unknown=0;retainSourceErrorTails(row,()=>{unknown++});expect(unknown).toBe(0);}runtime.requireEffectInventory();await runtime.auditEffectInventory(async accept=>{for(const row of rows)accept(row);},true);const p=runtime.port();expect(p.service.store.db.prepare('SELECT count(*) n FROM unproven_effects').get()?.n).toBe(2022);expect(p.service.store.db.prepare("SELECT value FROM continuity_meta WHERE key='effectInventoryPolicy'").get()?.value).toBe('1');expect(()=>runtime.assertConversationDeletionSafe('thread')).toThrow('blocked_unsettled');}finally{await runtime.close();rmSync(root,{recursive:true,force:true});}
},60_000);
it('does not certify a partial reader, and rejects retained collector calls after completion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inventory-partial-')),runtime=new DesktopContextContinuity(root);let retained:((value:TaskSnapshot)=>void)|undefined;
 try{runtime.requireEffectInventory();await expect(runtime.auditEffectInventory(async accept=>{retained=accept;accept(snapshot('task_one'));throw Error('disk_failed');},true)).rejects.toThrow('disk_failed');expect(runtime.port().service.store.db.prepare("SELECT value FROM continuity_meta WHERE key='effectInventoryPolicy'").get()).toBeUndefined();expect(()=>retained!(snapshot('task_late'))).toThrow('continuity_inventory_closed');expect(()=>runtime.assertConversationDeletionSafe('thread')).toThrow('blocked_unsettled');}finally{await runtime.close();rmSync(root,{recursive:true,force:true});}
});
it('enumerates every durable identity, including orphan journals, and rejects unsafe entries',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inventory-identities-')),store=new FileTaskSnapshotStore(root);
 try{await store.save({...snapshot('task_terminal'),events:[]});writeFileSync(join(root,'snapshots','task_orphan.journal.jsonl'),'{}\n');expect((await store.inspectPersistedTaskIds()).sort()).toEqual(['task_orphan','task_terminal']);symlinkSync(join(root,'snapshots','task_terminal.json'),join(root,'snapshots','task_link.json'));await expect(store.inspectPersistedTaskIds()).rejects.toThrow('task_inventory_unavailable');}finally{rmSync(root,{recursive:true,force:true});}
});
it('owns each accepted record before a producer can mutate its original',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inventory-owned-')),runtime=new DesktopContextContinuity(root);const original=snapshot('task_original');
 try{runtime.requireEffectInventory();await runtime.auditEffectInventory(async accept=>{accept(original);original.taskId='task_mutated';},false);const db=runtime.port().service.store.db;expect(db.prepare("SELECT 1 FROM unproven_effects WHERE task_id='task_original'").get()).toBeTruthy();expect(db.prepare("SELECT 1 FROM unproven_effects WHERE task_id='task_mutated'").get()).toBeUndefined();}finally{await runtime.close();rmSync(root,{recursive:true,force:true});}
});
it('does not complete the policy transaction when shutdown begins during the original reader',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inventory-shutdown-')),runtime=new DesktopContextContinuity(root);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const path=join(root,'continuity.sqlite');runtime.port();runtime.requireEffectInventory();
 const auditing=runtime.auditEffectInventory(async accept=>{accept(snapshot('task_before_close'));await gate;},false);
 const rejected=expect(auditing).rejects.toThrow('continuity_stopping');const closing=runtime.close();release();await rejected;await closing;
 try{const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path,{readOnly:true});try{expect(db.prepare("SELECT value FROM continuity_meta WHERE key='effectInventoryPolicy'").get()).toBeUndefined();}finally{db.close();}}finally{rmSync(root,{recursive:true,force:true});}
});
