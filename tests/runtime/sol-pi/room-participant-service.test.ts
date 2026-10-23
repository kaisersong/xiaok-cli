import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createRoomParticipantDispatch} from '../../../src/runtime/sol-pi/room-participant-service.js';
import {createCompositeParticipantVerifier,readCompositeParticipantReceipt} from '../../../src/runtime/sol-pi/composite-participant-receipt.js';
it('uses actual Room transactions from setup through a verifiable prepared receipt',async()=>{
 const {createRoomStore}=await import(pathToFileURL(resolve('../intent-broker/src/room/store.js')).href),{createRoomService}=await import(pathToFileURL(resolve('../intent-broker/src/room/service.js')).href);
 const root=mkdtempSync(join(tmpdir(),'room-participant-')),store=createRoomStore({dbPath:join(root,'rooms.sqlite'),storageBudget:{databaseBytes:64*1024**2}});store.migrate();const keys=generateKeyPairSync('ed25519'),definition={version:1 as const,kind:'participant' as const,authorityId:'participant',instanceEpoch:1,keyId:'key',publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:700,packageHash:'a'.repeat(64),controllerAuthorityId:'controller'};
 const dispatch=createRoomParticipantDispatch({store,roomService:createRoomService({store}),definition,privateKey:keys.privateKey}),user:any={sessionId:'desktop',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString(),hostPrincipal:'host'};
 const call=(method:string,input:unknown,context=user)=>dispatch({method,input,context});
 try{const roomId=call('createRoom',{title:'source',memberAgentIds:['a']}).room.roomId;user.hostIncarnation=call('registerHost',{startupId:'boot'}).host.hostIncarnation;
 let r=call('beginChange',{roomId,expectedRevision:0,requestId:'bind',payloadDigest:'a'.repeat(64)});r=call('commitBinding',{roomId,expectedRevision:r.config.revision,operationId:r.config.operationId,workspaceId:'workspace',bindingId:'binding',payloadDigest:'a'.repeat(64)});r=call('activateBinding',{roomId,expectedRevision:r.config.revision,operationId:r.config.operationId});expect(r.ok).toBe(true);
 const agent={...user,requestSource:'agent',actor:{kind:'agent',logicalAgentId:'a'},allowedLogicalAgentIds:['a']},c=call('acquireClaim',{roomId,runId:'run',executorInstanceId:'executor',contextScope:{kind:'room_only'},capability:{contextVersion:1,resultVersion:1,releaseVersion:1,canSetCwd:true,canTrackChildren:true,canRelease:true}},agent).claim;
 const echo=Object.fromEntries(['protocolVersion','runId','executorInstanceId','workspaceId','originHostId','hostIncarnation','bindingId','generation','instructionsRevision'].map(k=>[k,c[k]]));expect(call('ackClaim',{roomId,claimId:c.claimId,...echo,cwdVerified:true,actualCwd:'/fixture'},agent).ok).toBe(true);
 const destination={url:'https://example.test/chat',model:'local',protocol:'generic-openai'},grant=call('approveDisclosureGrant',{roomId,requestId:'grant',logicalAgentId:'a',destination,expiresAt:Date.now()+60000}).grant;
 const request={roomId,claimId:c.claimId,grantId:grant.grantId,attemptId:'attempt',invocationId:'invocation',bodySha256:'b'.repeat(64),destination,egressId:'egress',egressGeneration:1,sourceMessageIds:[],includeInstructions:false},prepared=call('prepareDisclosure',request,agent);expect(prepared.ok).toBe(true);
 const verifier=createCompositeParticipantVerifier({authorityId:'participant',authorityGeneration:1,instanceIncarnation:'1',keyId:'key',publicKey:keys.publicKey}),receipt=verifier.verify(Buffer.from(prepared.receipt,'base64'),{egressId:'egress',egressGeneration:1,attemptId:'attempt',invocationId:'invocation',bodySha256:'b'.repeat(64),destination:destination.url,model:destination.model,protocol:destination.protocol});expect(readCompositeParticipantReceipt(verifier,receipt).leaseId).toBe('attempt');expect(call('queryDisclosure',{roomId,attemptId:'attempt'},agent).lease.state).toBe('PREPARED');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
