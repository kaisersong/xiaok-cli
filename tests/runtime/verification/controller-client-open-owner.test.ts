import {it,expect} from 'vitest';import {generateKeyPairSync} from 'node:crypto';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {encodeControllerResponse} from '../../../src/runtime/verification/controller-response.js';
it('allows only synchronous read-scope recovery and inspect through the signed fresh-ticket client',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),seen:string[]=[];
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey,roundTrip:async()=>{throw Error('not used');},roundTripSync(bytes){const r=JSON.parse(bytes.toString());seen.push(r.method);const result=r.method==='controller.identity'?{serviceEpoch:'epoch',requestTicket:'a'.repeat(64)}:{readGrant:'fixture-read-only'};return encodeControllerResponse({domain:'xiaok.controller.response.v1',authorityId:'authority',serviceEpoch:'epoch',nonce:r.nonce,method:r.method,requestHash:r.requestHash,result},privateKey);}});
 try{expect((client.completionTransport.callSync as any)('completion.open-owner',{ownerKind:'task',ownerId:'task'})).toEqual({readGrant:'fixture-read-only'});expect(seen).toEqual(['controller.identity','completion.open-owner']);expect(()=>(client.completionTransport.callSync as any)('completion.authorize-owner',{challengeId:'c'})).toThrow('controller_completion_method');expect(seen).toHaveLength(2);}finally{client.dispose();}
});
