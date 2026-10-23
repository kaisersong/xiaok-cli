import {it,expect} from 'vitest';import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
it('carries only fixed application methods over the actual signed controller transport',async()=>{
 const root=mkdtempSync(join(tmpdir(),'application-ipc-')),socketPath=join(root,'socket'),keys=generateKeyPairSync('ed25519'),seen:string[]=[];
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:keys.privateKey,allowedUserIds:[501],acceptPeer:()=>({uid:501,gid:20,auditSessionId:4}),async invoke(method,payload,peer){seen.push(method);expect(peer.uid).toBe(501);return {method,payload};}});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync(){throw Error('unused');}});
 try{
  for(const method of ['application.prepare','application.prepareRequest','application.lookupRequest','application.recoverRequest','application.authorize','application.inspect','application.reconcile'] as const){const payload={identity:'original'},pending=client.applicationTransport.call(method,payload);payload.identity='changed-after-call';expect(await pending).toEqual({method,payload:{identity:'original'}});}
  await expect(client.applicationTransport.call('publication.approve' as never,{})).rejects.toThrow('controller_application_method');
  await expect(client.applicationTransport.call('application.delete' as never,{})).rejects.toThrow('controller_application_method');
  expect(seen).toEqual(['application.prepare','application.prepareRequest','application.lookupRequest','application.recoverRequest','application.authorize','application.inspect','application.reconcile']);
 }finally{client.dispose();await server.close();rmSync(root,{recursive:true,force:true});}
});
it.each([
 ['peer outside allowlist',()=>({uid:999,gid:20,auditSessionId:4})],
 ['peer with extra own field',()=>({uid:501,gid:20,auditSessionId:4,extra:true})],
])('rejects %s before dispatch over the actual socket',async(_name,peer)=>{
 const root=mkdtempSync(join(tmpdir(),'application-ipc-peer-')),socketPath=join(root,'socket'),keys=generateKeyPairSync('ed25519');let calls=0;
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:keys.privateKey,allowedUserIds:[501],acceptPeer:peer,async invoke(){calls++;return 'unexpected';}});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync(){throw Error('unused');}});
 try{await expect(client.applicationTransport.call('application.inspect',{ownerKind:'goal',ownerId:'goal'})).rejects.toThrow();expect(calls).toBe(0);}
 finally{client.dispose();await server.close();rmSync(root,{recursive:true,force:true});}
});
