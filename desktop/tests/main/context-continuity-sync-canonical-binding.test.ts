// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
vi.mock('electron',()=>({app:{}}));
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {createCanonicalStoreSyncOwner} from '../../electron/context-continuity/sync-canonical-store-owner.js';
import type {DesktopSyncDevice} from '../../electron/context-continuity/sync-device-runtime.js';

function fixture(){const root=mkdtempSync(join(tmpdir(),'continuity-original-store-binding-')),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'},source=service.createConversation(actor,{operationId:'source'}),target=service.createConversation(actor,{operationId:'target'});service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'original-user-metadata',sourceDataEpoch:'epoch',sourceMessageId:'user',sourceRevision:1,role:'user',text:'UNKNOWN_LOCAL_INPUT',executionState:'unknown'});const current=service.getConversation(actor,source.id)!,ref=service.createReference(actor,{conversationId:source.id,expectedRevision:current.revision,operationId:'ref'}),grant=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'});return {service,actor,source,ref,grant,close(){service.close();rmSync(root,{recursive:true,force:true});}};}
it('only the original pending Store can claim its channel; caller factories and copied wrappers have no authority',async()=>{
 const f=fixture();try{
  let getterCalls=0;const fake=Object.defineProperty({kind:'desktop-sync-device'},'getCanonicalStoreAnchor',{get(){getterCalls++;throw new Error('must_not_read_caller_getter');}})as unknown as DesktopSyncDevice;
  for(const store of [f.service.store,{}])expect(()=>createCanonicalStoreSyncOwner(store as never,{},fake)).toThrow('canonical_store_binding_unavailable');
  await expect(f.service.store.bindCanonicalSyncDevice(fake)).rejects.toThrow('desktop_sync_device_unavailable');expect(getterCalls).toBe(0);
 }finally{f.close();}
});
it('pending and failed binding deny old local readers and actual policy writes even with no imported scope rows',async()=>{
 const f=fixture();try{
  const pending=f.service.store.bindCanonicalSyncDevice({}as DesktopSyncDevice);
  expect(()=>f.service.resolveReference(f.actor,{refId:f.ref.refId})).toThrow('not_readable');expect(()=>f.service.revokeGrant(f.actor,{grantId:f.grant.grantId})).toThrow('not_readable');
  await expect(pending).rejects.toThrow('desktop_sync_device_unavailable');
  expect(f.service.store.db.prepare('SELECT * FROM sync_scopes').all()).toEqual([]);
  expect(()=>f.service.resolveReference(f.actor,{refId:f.ref.refId})).toThrow('not_readable');expect(()=>f.service.revokeGrant(f.actor,{grantId:f.grant.grantId})).toThrow('not_readable');
  expect(f.service.store.db.prepare('SELECT revoked FROM read_grants WHERE id=?').get(f.grant.grantId)?.revoked).toBe(0);
 }finally{f.close();}
});
it('unbound, pending and copied source-state inputs cannot mint an original committed Store component',async()=>{
 const f=fixture();try{const {assertOriginalCanonicalSourceState}=await import('../../electron/context-continuity/sync-canonical-store-owner.js');let calls=0;const ids=Object.defineProperty([],'0',{get(){calls++;return f.source.id;}})as unknown as string[];
 expect(()=>f.service.store.captureCanonicalSourceState({}as DesktopSyncDevice,ids)).toThrow('not_readable');expect(calls).toBe(0);
 for(const cap of [{kind:'original-canonical-store-state-component'},Object.freeze({capturedStoreHead:{sequence:1,hash:'f'.repeat(64)}}),new Proxy({},{})])expect(()=>assertOriginalCanonicalSourceState(f.service.store,{}as DesktopSyncDevice,cap)).toThrow('not_readable');
 const pending=f.service.store.bindCanonicalSyncDevice({}as DesktopSyncDevice);expect(()=>f.service.store.captureCanonicalSourceState({}as DesktopSyncDevice,[f.source.id])).toThrow('not_readable');await expect(pending).rejects.toThrow();expect(()=>f.service.store.captureCanonicalSourceState({}as DesktopSyncDevice,[f.source.id])).toThrow('not_readable');
 }finally{f.close();}
});
