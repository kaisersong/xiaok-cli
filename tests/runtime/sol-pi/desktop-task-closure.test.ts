import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desktopObservationSessionId } from '../../../src/runtime/task-host/protected-observation-store.js';
import { FileTaskSnapshotStore, recoverTaskSnapshotSync } from '../../../src/runtime/task-host/snapshot-store.js';
import { buildHistoryFromTaskSnapshots } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'12345678-1234-1234-1234-123456789abc',profileId:'profile',sourceSessionId:'source',ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,observationId:'obs',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1}]};
const task=(extra={})=>({taskId:'task',sessionId:'session',status:'completed',prompt:'input',materials:[],events:[],result:{reply:'protected derived answer',artifacts:[]},createdAt:1,updatedAt:1,...extra}) as TaskSnapshot;
describe('Desktop task protected closure durable sidecar',()=>{
 it('keeps closure through a stale task save and a fresh store instance',async()=>{
  const root=await mkdtemp(join(tmpdir(),'desktop-closure-'));roots.push(root);
  const store=new FileTaskSnapshotStore(root);await store.save(task({protectedObservationClosure:closure}));
  await new FileTaskSnapshotStore(root).save(task());
  expect((await new FileTaskSnapshotStore(root).recoverTask('task'))?.protectedObservationClosure).toEqual(closure);
 });
 it('rejects synthesized protected task history instead of silently dropping metadata',()=>{
  expect(()=>buildHistoryFromTaskSnapshots([task({protectedObservationClosure:closure})])).toThrow(/OBSERVATION.*RESTORE|PROTECTED.*HISTORY/);
 });
 it('damaged or missing-marker sidecars fail closed for async and sync readers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'desktop-closure-'));roots.push(root);await new FileTaskSnapshotStore(root).save(task({protectedObservationClosure:closure}));
  const file=join(root,'protected-observation-sessions',desktopObservationSessionId('task')+'.json');
  for(const bytes of ['{',JSON.stringify({schemaVersion:1,sessionId:desktopObservationSessionId('task'),messages:[]})]){
    await writeFile(file,bytes);await expect(new FileTaskSnapshotStore(root).recoverTask('task')).rejects.toThrow(/PROTECTED_HISTORY_STORE/);
    expect(()=>recoverTaskSnapshotSync(root,'task')).toThrow(/PROTECTED_HISTORY_STORE/);
  }
 });

});
