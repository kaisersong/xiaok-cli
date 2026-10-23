// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createDesktopObservationLifecycle} from '../../electron/desktop-observation-lifecycle.js';
import {ReferenceDeletionReceiptStore} from '../../../src/runtime/sol-pi/reference-lifecycle.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
vi.mock('../../../src/runtime/sol-pi/product-bootstrap.js',()=>({reconcileProductObservationReferences:vi.fn(async()=>{})}));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('Desktop user thread deletion reference journal',()=>{
 it('keeps pending references then recovers only from the matching durable user deletion receipt',async()=>{
  const root=mkdtempSync(join(tmpdir(),'desktop-ref-delete-'));roots.push(root);const tasksRoot=join(root,'tasks'),profileRoot=join(root,'profile');
  const ref={authorityId:'11111111-1111-4111-8111-111111111111',profileId:'profile',sourceSessionId:desktopObservationSessionId('task'),ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,observationId:'obs',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1};
  await new FileTaskSnapshotStore(tasksRoot).save({taskId:'task',sessionId:'session',context:{threadId:'thread'},status:'completed',prompt:'p',materials:[],events:[],createdAt:1,updatedAt:1,protectedObservationClosure:{version:1,requiresReauthorization:true,observations:[ref]}} as TaskSnapshot);
  let committed=false;const lifecycle=createDesktopObservationLifecycle({tasksRoot,profileRoot,getDeletionState:()=>({operationId:'delete-1',completed:committed})});const commit=lifecycle.beforeDelete('thread','delete-1');
  let receipts=new ReferenceDeletionReceiptStore(profileRoot);const facts={...ref,referenceId:`session:${ref.sourceSessionId}`};expect(receipts.resolve(facts).state).toBe('unknown');receipts.close();expect(()=>commit()).toThrow('not_committed');
  committed=true;await lifecycle.recover();receipts=new ReferenceDeletionReceiptStore(profileRoot);expect(receipts.resolve(facts).state).toBe('deleted');expect(receipts.pending()).toEqual([]);receipts.close();
 });
});
