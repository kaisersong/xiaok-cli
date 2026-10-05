import { it, expect } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPublicController } from '../../../src/runtime/verification/controller-public-daemon.js';
import { callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
import { canonicalVerificationJson } from '../../../src/runtime/verification/protocol.js';
import { createAuthenticatedControllerClient } from '../../../src/runtime/verification/controller-client.js';
it('uses connection-owned caller facts and routes every signed response through the full frame budget', async () => {
 const root=mkdtempSync(join(tmpdir(),'public-controller-'));const socketPath=join(root,'service.sock');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');let invoked=0;
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey,allowedUserIds:[501],
  acceptPeer:()=>Object.freeze({uid:501,gid:20,auditSessionId:42}), async invoke(method,payload,peer){invoked++;expect(peer).toEqual({uid:501,gid:20,auditSessionId:42});return {challengeId:'challenge',canonicalReview:payload};}});
 try {
  const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey,roundTrip:b=>callControllerIpc(socketPath,b),roundTripSync(){throw Error('unused');}});
  await expect(client.materialAuthorization.prepareMaterialAuthorization({} as any,{signal:new AbortController().signal})).resolves.toHaveProperty('challengeId','challenge');
  const issue=async()=>{const request={version:1,domain:'xiaok.controller.request.v1',authorityId:'authority',serviceEpoch:null,requestTicket:null,nonce:'f'.repeat(64),method:'controller.identity',requestHash:createHash('sha256').update('{}').digest('hex'),payload:{}};return JSON.parse((await callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson(request)))).toString()).payload.result.requestTicket;};
  const payload={};const valid={version:1,domain:'xiaok.controller.request.v1',authorityId:'authority',serviceEpoch:'epoch',requestTicket:await issue(),nonce:'a'.repeat(64),method:'materials.prepare',requestHash:createHash('sha256').update(canonicalVerificationJson(payload)).digest('hex'),payload};
  await expect(callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson({...valid,uid:0})))).rejects.toThrow();
  await expect(callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson({...valid,requestHash:'b'.repeat(64)})))).rejects.toThrow();
  expect(invoked).toBe(1);
  await callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson(valid)));
  await expect(callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson(valid)))).rejects.toThrow();
  expect(invoked).toBe(2);
  await expect(client.completionTransport.call('completion.inspect', {owner:'task'})).resolves.toHaveProperty('challengeId','challenge');
  await expect(client.completionTransport.call('issuer' as any, {})).rejects.toThrow('controller_completion_method');
  expect(()=>client.completionTransport.callSync('completion.settle' as any, {})).toThrow('controller_completion_method');
  await expect(callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson({...valid,nonce:'c'.repeat(64),serviceEpoch:'old-epoch'})))).rejects.toThrow();
  expect(invoked).toBe(3);client.dispose();
 } finally {await server.close();rmSync(root,{recursive:true,force:true});}
});

it('consumes a peer-bound ticket before awaiting the handler and rejects other login sessions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'public-ticket-')),socketPath=join(root,'service.sock');const {privateKey}=generateKeyPairSync('ed25519');let asid=10,invoked=0,release!:()=>void;const held=new Promise<void>(r=>release=r);
 const server=await startPublicController({socketPath,authorityId:'a',serviceEpoch:'e',privateKey,allowedUserIds:[501],acceptPeer(){return {uid:501,gid:20,auditSessionId:asid};},async invoke(){invoked++;await held;return {};}});
 const base={version:1,domain:'xiaok.controller.request.v1',authorityId:'a',nonce:'b'.repeat(64),payload:{},requestHash:createHash('sha256').update('{}').digest('hex')};
 try{
  const hello={...base,method:'controller.identity',serviceEpoch:null,requestTicket:null};const identity=JSON.parse((await callControllerIpc(socketPath,Buffer.from(canonicalVerificationJson(hello)))).toString()).payload.result;
  const request=Buffer.from(canonicalVerificationJson({...base,method:'completion.inspect',serviceEpoch:'e',requestTicket:identity.requestTicket}));
  asid=11;await expect(callControllerIpc(socketPath,request)).rejects.toThrow();expect(invoked).toBe(0);asid=10;
  const first=callControllerIpc(socketPath,request);while(!invoked)await new Promise(r=>setImmediate(r));await expect(callControllerIpc(socketPath,request)).rejects.toThrow();expect(invoked).toBe(1);release();await first;
 }finally{release();await server.close();rmSync(root,{recursive:true,force:true});}
});
