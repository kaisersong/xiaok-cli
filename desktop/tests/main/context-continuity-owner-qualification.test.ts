// @vitest-environment node
import {expect,it,vi} from 'vitest';import {createServer,type Socket} from 'node:net';
import {mkdtempSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ensureConversationActivityOwner} from '../../../src/runtime/conversation-activity/owner-launcher.js';
import {activityOwnerConfigDigest,type ActivityOwnerConfig} from '../../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerAddress,createActivityOwnerCredentials,authenticateActivityClient} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {ACTIVITY_STORAGE_NAMES} from '../../../src/runtime/conversation-activity/storage-permissions.js';
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'continuity-owner-qualification-')),runtime=new DesktopContextContinuity(root),p=runtime.port();
 const address=activityOwnerAddress(root),config:ActivityOwnerConfig={schemaVersion:1,dataRoot:address.dataRoot,profileId:p.actor.profileId,actorId:p.actor.actorId,identity:{kind:'desktop',path:join(address.dataRoot,'multi-agent','groups.sqlite')}};
 const credentials=createActivityOwnerCredentials(address),digest=activityOwnerConfigDigest(config),file=join(root,ACTIVITY_STORAGE_NAMES.config);
 writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const sockets=new Set<Socket>(),received:Array<{generation:unknown;method:string}>=[];
 let hello:Record<string,unknown>={type:'hello',protocol:1,rootHash:address.rootHash,ownerEpoch:'qualified-epoch',generation:4,profileId:config.profileId,configDigest:digest,ready:true};
 const server=createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.setEncoding('utf8');let buffer='',admitted=false,connectionHello:Record<string,unknown>;
  socket.on('data',(chunk:string)=>{buffer+=chunk;for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const message=JSON.parse(line);
   if(!admitted){authenticateActivityClient(credentials,message);admitted=true;connectionHello={...hello};socket.write(JSON.stringify(connectionHello)+'\n');continue;}
   received.push({generation:connectionHello!.generation,method:message.method});socket.write(JSON.stringify({type:'result',id:message.id,result:message.method==='status'?{...connectionHello!,pid:process.pid}:[]})+'\n');
  }});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(address.socketPath,()=>resolve());});
 return {root,runtime,config,file,received,setHello:(patch:Record<string,unknown>)=>{hello={...hello,...patch};},disconnect:()=>{for(const socket of sockets)socket.destroy();},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();rmSync(root,{recursive:true,force:true});}};
}
it.each(['kept_pending','kept_unknown','kept_unverified'] as const)('does not reuse, rewrite config or spawn when an old protected owner is %s',async outcome=>{
 const f=await fixture(),spawn=vi.fn(),retire=vi.fn(async()=>outcome);f.setHello({generation:3});const before=readFileSync(f.file,'utf8');let client:ConversationActivityOwnerClient|undefined;
 try{const result=ensureConversationActivityOwner(f.config,{spawn:spawn as never,retire}).then(value=>{client=value;return value;});await expect(result).rejects.toThrow('activity_owner_policy_upgrade_blocked');expect(readFileSync(f.file,'utf8')).toBe(before);expect(spawn).not.toHaveBeenCalled();expect(retire).toHaveBeenCalledOnce();}
 finally{client?.dispose();await f.close();}
});
it('qualifies every new protected socket before sending business requests or replaying subscriptions',async()=>{
 const f=await fixture(),client=new ConversationActivityOwnerClient(f.root,'producer');
 try{await client.connect();const stop=await client.subscribeOverview(()=>{});f.setHello({generation:3,ownerEpoch:'older-epoch'});f.disconnect();await vi.waitFor(()=>expect(client.ownerEpoch).toBeUndefined());
  await expect(client.request('list',{threadId:'target'})).rejects.toThrow(/activity_owner_/);
  expect(f.received.filter(row=>row.generation===3&&row.method!=='status')).toEqual([]);stop();
 }finally{client.dispose();await f.close();}
});
it.each([{generation:5},{generation:'4'},{ready:undefined},{ready:false},{profileId:'foreign'},{configDigest:'foreign'},{ownerEpoch:''}])('rejects an unqualified protected hello %j before business disclosure',async patch=>{
 const f=await fixture();f.setHello(patch);const client=new ConversationActivityOwnerClient(f.root,'producer');
 try{await expect(client.request('list',{threadId:'target'})).rejects.toThrow(/activity_owner_/);expect(f.received.filter(row=>row.method!=='status')).toEqual([]);}
 finally{client.dispose();await f.close();}
});

it('returns a qualified business client after a read-only probe and requalifies its reconnect',async()=>{
 const f=await fixture();let client:ConversationActivityOwnerClient|undefined;
 try{client=await ensureConversationActivityOwner(f.config,{spawn:vi.fn() as never});await expect(client.request('list',{threadId:'target'})).resolves.toEqual([]);
  f.setHello({generation:3,ownerEpoch:'old-after-ensure'});f.disconnect();await vi.waitFor(()=>expect(client!.ownerEpoch).toBeUndefined());await expect(client.request('list',{threadId:'target'})).rejects.toThrow(/activity_owner_/);expect(f.received.filter(row=>row.generation===3&&row.method!=='status')).toEqual([]);
 }finally{client?.dispose();await f.close();}
});
it('does not downgrade a retained Desktop configuration to Standalone when profile authority files are lost',async()=>{
 const f=await fixture();let client:ConversationActivityOwnerClient|undefined;
 try{await f.runtime.close();for(const name of ['continuity-profile.json','continuity.sqlite','continuity.sqlite-wal','continuity.sqlite-shm'])rmSync(join(f.root,name),{force:true});f.setHello({generation:3});
  const request=(async()=>{client=new ConversationActivityOwnerClient(f.root,'producer');return client.request('list',{threadId:'target'});})();await expect(request).rejects.toThrow('activity_owner_qualification_unavailable');expect(f.received.filter(row=>row.method!=='status')).toEqual([]);
 }finally{client?.dispose();await f.close();}
});

it.skipIf(process.platform==='win32')('accepts an identity path alias only when it resolves to the same fixed profile repository',async()=>{
 const f=await fixture();let client:ConversationActivityOwnerClient|undefined;
 try{const alias=join(f.root,'domain-alias');symlinkSync(f.root,alias,'dir');const config={...f.config,identity:{...f.config.identity,path:join(alias,'multi-agent','groups.sqlite')}};writeFileSync(f.file,JSON.stringify(config),{mode:0o600});f.setHello({configDigest:activityOwnerConfigDigest(config)});
  client=new ConversationActivityOwnerClient(f.root,'producer');await expect(client.request('list',{threadId:'target'})).resolves.toEqual([]);
 }finally{client?.dispose();await f.close();}
});

it.skipIf(process.platform==='win32')('rejects an identity alias that resolves to a different profile repository before sending business requests',async()=>{
 const f=await fixture(),foreign=mkdtempSync(join(tmpdir(),'continuity-owner-foreign-'));let client:ConversationActivityOwnerClient|undefined;
 try{const alias=join(f.root,'foreign-alias');symlinkSync(foreign,alias,'dir');const config={...f.config,identity:{...f.config.identity,path:join(alias,'multi-agent','groups.sqlite')}};writeFileSync(f.file,JSON.stringify(config),{mode:0o600});f.setHello({configDigest:activityOwnerConfigDigest(config)});
  const request=(async()=>{client=new ConversationActivityOwnerClient(f.root,'producer');return client.request('list',{threadId:'target'});})();
  await expect(request).rejects.toThrow('activity_owner_qualification_unavailable');expect(f.received).toEqual([]);
 }finally{client?.dispose();await f.close();rmSync(foreign,{recursive:true,force:true});}
});
