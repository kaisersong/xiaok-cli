// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';import {mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {EventEmitter} from 'node:events';import type {spawn} from 'node:child_process';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ensureConversationActivityOwner} from '../../../src/runtime/conversation-activity/owner-launcher.js';
import {activityOwnerConfigDigest,startConversationActivityOwner,type ActivityOwnerConfig} from '../../../src/runtime/conversation-activity/owner-runtime.js';
import {ACTIVITY_STORAGE_NAMES} from '../../../src/runtime/conversation-activity/storage-permissions.js';
import {loadContinuityProfile} from '../../electron/context-continuity/profile.js';
const cleanup:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'continuity-identity-daemon-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const profile=loadContinuityProfile(root),legacy=createHash('sha256').update(root).digest('hex');
 const config:ActivityOwnerConfig={schemaVersion:1,dataRoot:root,profileId:profile,actorId:`desktop-user:${profile}`,identity:{kind:'desktop',path:join(root,'multi-agent/groups.sqlite')}};
 const old={...config,dataRoot:realpathSync(root),profileId:legacy,actorId:`desktop-user:${legacy}`};
 writeFileSync(join(root,ACTIVITY_STORAGE_NAMES.config),JSON.stringify(old),{mode:0o600});
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:legacy,actorId:old.actorId,configDigest:activityOwnerConfigDigest(old),getThread:()=>null,canObserveWork:()=>false,authorizeProducer:()=>false});cleanup.push(()=>host.stop());
 host.store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:legacy,threadId:'thread',workspaceId:'workspace'}});
 await host.start();return {root,profile,legacy,config,host};
}
it('refuses migration while an authenticated old owner cannot retire and retains its exclusive store',async()=>{
 const f=await fixture(),retire=vi.fn(async()=> 'kept_pending' as const),launch=vi.fn();
 await expect(ensureConversationActivityOwner(f.config,{retire,spawn:launch as unknown as typeof spawn})).rejects.toThrow('activity_profile_migration_blocked');
 expect(retire).toHaveBeenCalledOnce();expect(launch).not.toHaveBeenCalled();expect(f.host.store.getAssociation('operation')?.origin.profileId).toBe(f.legacy);
});
it('verifies the old private owner config, retires it, then migrates only after the new physical owner acquires the lock',async()=>{
 const f=await fixture();let next:ConversationActivityOwnerHost|undefined;let starting:Promise<void>|undefined;
 const retire=vi.fn(async()=>{await f.host.stop();return 'retired' as const;});
 const launch=vi.fn(()=>{
   next=new ConversationActivityOwnerHost({dataRoot:f.root,profileId:f.profile,actorId:f.config.actorId,migrateFromProfileId:f.legacy,configDigest:activityOwnerConfigDigest({...f.config,dataRoot:realpathSync(f.root)}),getThread:()=>null,canObserveWork:()=>false,authorizeProducer:()=>false});cleanup.push(()=>next!.stop());
   starting=next.start();return Object.assign(new EventEmitter(),{unref:()=>{}});
 });
 const client=await ensureConversationActivityOwner(f.config,{retire,spawn:launch as unknown as typeof spawn,timeoutMs:3000});cleanup.push(()=>client.dispose());await starting;
 expect(retire).toHaveBeenCalledOnce();expect(launch).toHaveBeenCalledOnce();expect(next!.store.getAssociation('operation')?.origin.profileId).toBe(f.profile);
});
it('does not retire a mismatched config and refuses to boot a legacy daemon config after UUID migration',async()=>{
 const f=await fixture(),retire=vi.fn(async()=> 'retired' as const);
 writeFileSync(join(f.root,ACTIVITY_STORAGE_NAMES.config),JSON.stringify({...f.config,profileId:f.legacy,actorId:'foreign'}),{mode:0o600});
 await expect(ensureConversationActivityOwner(f.config,{retire})).rejects.toThrow('activity_owner_profile_mismatch');expect(retire).not.toHaveBeenCalled();
 await expect(startConversationActivityOwner({...f.config,profileId:f.legacy,actorId:`desktop-user:${f.legacy}`})).rejects.toThrow('activity_owner_profile_mismatch');
});
