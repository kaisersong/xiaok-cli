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
  for(const method of ['application.prepare','application.authorize','application.inspect','application.reconcile'] as const)expect(await client.applicationTransport.call(method,{identity:'original'})).toEqual({method,payload:{identity:'original'}});
  await expect(client.applicationTransport.call('publication.approve' as never,{})).rejects.toThrow('controller_application_method');
  await expect(client.applicationTransport.call('application.delete' as never,{})).rejects.toThrow('controller_application_method');
  expect(seen).toHaveLength(4);
 }finally{client.dispose();await server.close();rmSync(root,{recursive:true,force:true});}
});
