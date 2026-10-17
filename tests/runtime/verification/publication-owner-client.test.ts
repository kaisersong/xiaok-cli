import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';

const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'};
const committed=()=>({owner:{...owner},businessRevision:1,currentVerification:'valid',publication:{status:'committed',current:true,operationId:'operation',fullTupleHash:'a'.repeat(64)}});
function fixture(reply:unknown){
 const calls:Array<{method:string;payload:unknown}>=[];
 const client=createPublicationClient({owner,requestSource:'agent',transport:{async call(method,payload){calls.push({method,payload});return reply;}}});
 return {client,calls};
}
it('reads the bound owner without a cached challenge and freezes the returned observation',async()=>{
 const reply=committed(),{client,calls}=fixture(reply),observed=await client.observe();
 expect(calls).toEqual([{method:'publication.observeOwner',payload:{ownerKind:'task',ownerId:'task'}}]);
 expect(observed).toEqual(reply);
 expect(Object.isFrozen(observed)).toBe(true);expect(Object.isFrozen(observed.owner)).toBe(true);expect(Object.isFrozen(observed.publication)).toBe(true);
 reply.publication.current=false;reply.owner.ownerId='other';
 expect(observed.owner.ownerId).toBe('task');expect(observed.publication).toMatchObject({current:true});
});
it('preserves absent, unknown and stale committed observations without manufacturing current success',async()=>{
 for(const publication of [{status:'absent'},{status:'unknown',current:false,operationId:'operation',fullTupleHash:'a'.repeat(64)},{status:'committed',current:false,operationId:'operation',fullTupleHash:'a'.repeat(64)}]){
  const reply={owner,businessRevision:0,currentVerification:'needs_revalidation',publication};
  expect(await fixture(reply).client.observe()).toEqual(reply);
 }
});
it('rejects wrong owners, malformed revisions and contradictory or extended publication responses',async()=>{
 const invalid=[
  {...committed(),owner:{...owner,profileId:'other'}},
  {...committed(),businessRevision:-1}, {...committed(),businessRevision:1.5},
  {...committed(),currentVerification:'unavailable'},
  {...committed(),publication:{...committed().publication,status:'cancelled'}},
  {...committed(),publication:{...committed().publication,current:'true'}},
  {...committed(),publication:{...committed().publication,fullTupleHash:'invalid'}},
  {...committed(),publication:{status:'absent',current:true}},
  {...committed(),publication:{...committed().publication,grant:true}},
  {...committed(),grant:true},
 ];
 for(const reply of invalid)await expect(fixture(reply).client.observe()).rejects.toThrow(/publication_client_/);
});
it.each(['valid','changed-hash','bad-offset','bad-eof','corrupt-body','wrong-owner','changed-revision','changed-operation','zero-progress','noncanonical-base64','aborted'] as const)('reads the entire immutable published payload with strict pagination: %s',async mode=>{
 const body=Buffer.alloc(300*1024,97),hash=createHash('sha256').update(body).digest('hex');let pages=0;
 const reply=committed(),cancellation=new AbortController();
 const client=createPublicationClient({owner,requestSource:'agent',transport:{async call(method,payload){
  if(method==='publication.observeOwner')return reply;
  expect(method).toBe('publication.readOwnerPayload');const request=payload as {offset:number;maxBytes:number};
  expect(request.maxBytes).toBe(262144);expect(request.offset).toBe(pages++===0?0:262144);
  const bytes=Buffer.from(body.subarray(request.offset,request.offset+request.maxBytes));
  if(mode==='corrupt-body')bytes[0]=98;
  if(mode==='aborted')cancellation.abort(Error('publication_client_aborted'));
  return{owner:mode==='wrong-owner'?{...owner,ownerId:'other'}:owner,businessRevision:mode==='changed-revision'?2:1,operationId:mode==='changed-operation'?'other':'operation',fullTupleHash:'a'.repeat(64),payloadHash:mode==='changed-hash'&&pages===2?'b'.repeat(64):hash,totalBytes:body.length,offset:mode==='bad-offset'?request.offset+1:request.offset,bytes:mode==='zero-progress'?'':mode==='noncanonical-base64'?bytes.toString('base64')+'\n':bytes.toString('base64'),eof:mode==='bad-eof'?true:request.offset+bytes.length===body.length};
 }}});
 const observation=await client.observe();
 if(mode==='valid'){const result=await client.readPayload(observation);expect(result.bytes).toEqual(body);expect(result.payloadHash).toBe(hash);expect(pages).toBe(2);}
 else await expect(client.readPayload(observation,cancellation.signal)).rejects.toThrow(/publication_client_/);
});
