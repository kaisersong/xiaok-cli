import {expect,it} from 'vitest';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createServer} from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startControllerIpc,callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createCompositeEgressDispatch} from '../../../src/runtime/sol-pi/composite-egress-dispatch.js';
import {createCompositeEgressService} from '../../../src/runtime/sol-pi/composite-egress-service.js';
it.each(['direct','chunked-ipc'])('runs %s through real HTTPS and retains its terminal journal across reopen',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'composite-egress-service-')),keys=generateKeyPairSync('ed25519'),body=mode==='direct'?'{"message":"hello"}':JSON.stringify({message:'x'.repeat(2*1024**2)}),hash=createHash('sha256').update(body).digest('hex');
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url)),key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));let calls=0;
 const server=createServer({cert,key},(req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{calls++;expect(text).toBe(body);res.end(mode==='direct'?'hello back':'y'.repeat(2*1024**2));});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const destination=`https://127.0.0.1:${(server.address() as {port:number}).port}/chat`,identity={authorityId:'participant',authorityGeneration:1,instanceIncarnation:'1',keyId:'key'},expected={egressId:'egress',egressGeneration:1,attemptId:'one',invocationId:'invocation',bodySha256:hash,destination,model:'local',protocol:'generic-openai'};
 const payload={version:1,domain:'xiaok.composite.participant.prepared.v1',...identity,...expected,leaseId:'lease',evidenceSha256:'a'.repeat(64)},encoded=JSON.stringify(payload,Object.keys(payload).sort()),receipt=Buffer.from('{"payload":'+encoded+',"signature":'+JSON.stringify(sign(null,Buffer.from(encoded),keys.privateKey).toString('base64url'))+'}');
 const input={root,egressId:'egress',generation:1,participant:{...identity,publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString()},targets:[{destination,model:'local',protocol:'generic-openai',headers:{'content-type':'application/json'}}],assertCurrent(){},certificateAuthority:cert};let service=createCompositeEgressService(input);let ipc:Awaited<ReturnType<typeof startControllerIpc>>|undefined;
 try{expect(service.prepare({attemptId:'one',invocationId:'invocation',bodySha256:hash,destination,model:'local',protocol:'generic-openai',participants:[{authorityId:'participant',leaseId:'lease',evidenceSha256:'a'.repeat(64)}],reservationSha256:'b'.repeat(64)},receipt)?.state).toBe('PREPARED');if(mode==='direct')expect(await service.dispatch('one',body)).toEqual({status:200,body:'hello back'});else{
 const socketPath=join(tmpdir(),'egress-'+Math.random().toString(16).slice(2)+'.sock'),dispatch=createCompositeEgressDispatch(service);ipc=await startControllerIpc({socketPath,dispatch:async bytes=>Buffer.from(JSON.stringify(await dispatch(JSON.parse(bytes.toString('utf8')))))});
 const call=async(request:unknown)=>JSON.parse((await callControllerIpc(socketPath,Buffer.from(JSON.stringify(request)))).toString('utf8'));
 const bytes=Buffer.from(body);await call({method:'beginBody',attemptId:'one',totalBytes:bytes.length});for(let offset=0;offset<bytes.length;offset+=256*1024)await call({method:'appendBody',attemptId:'one',offset,bytesBase64:bytes.subarray(offset,offset+256*1024).toString('base64')});const result=await call({method:'dispatch',attemptId:'one'});expect(result.totalBytes).toBe(2*1024**2);const pieces:Buffer[]=[];for(let offset=0;offset<result.totalBytes;offset+=256*1024){const chunk=await call({method:'readResponse',attemptId:'one',offset});pieces.push(Buffer.from(chunk.bytesBase64,'base64'));}expect(Buffer.concat(pieces).toString('utf8')).toBe('y'.repeat(2*1024**2));expect(await call({method:'releaseResponse',attemptId:'one'})).toEqual({released:true});await ipc.close();ipc=undefined;
 }expect(calls).toBe(1);expect(service.query('one')?.state).toBe('SUCCEEDED');await service.close();service=createCompositeEgressService(input);expect(service.query('one')?.state).toBe('SUCCEEDED');}
 finally{await ipc?.close();await service.close();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
});
