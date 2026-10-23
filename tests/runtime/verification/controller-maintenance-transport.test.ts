import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';

it('exposes only signed maintenance diagnosis and rejects normal work while in maintenance',async()=>{
 const root=mkdtempSync(join(tmpdir(),'maintenance-ipc-')),socketPath=join(root,'s'),keys=generateKeyPairSync('ed25519'),seen:string[]=[];
 const server=await startPublicController({socketPath,authorityId:'a',serviceEpoch:'e',privateKey:keys.privateKey,allowedUserIds:[501],acceptPeer:()=>({uid:501,gid:20,auditSessionId:4}),async invoke(method,payload,peer){
  seen.push(method);expect(peer).toEqual({uid:501,gid:20,auditSessionId:4});
  if(method!=='maintenance.diagnose')throw Error('installed_controller_maintenance');
  expect(payload).toEqual({requestSource:'user',ownerKind:'task',ownerId:'task',cursor:null,limit:16});return {mode:'maintenance',items:[],nextCursor:null};
 }});
 const client=createAuthenticatedControllerClient({authorityId:'a',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes),roundTripSync(){throw Error('unused');}});
 try{
  await expect(client.maintenanceTransport.call('maintenance.diagnose',{requestSource:'user',ownerKind:'task',ownerId:'task',cursor:null,limit:16})).resolves.toEqual({mode:'maintenance',items:[],nextCursor:null});
  await expect(client.maintenanceTransport.call('maintenance.retryMigration' as any,{})).rejects.toThrow('controller_maintenance_method');
  await expect(client.verificationTransport.call('verification.prepare',{})).rejects.toThrow('controller_operation_rejected');
  expect(seen).toEqual(['maintenance.diagnose','verification.prepare']);
 }finally{client.dispose();await server.close();rmSync(root,{recursive:true,force:true});}
});
