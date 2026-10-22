import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
const owner={profileId:'profile',ownerKind:'loop' as const,ownerId:'loop'};
const tupleHash='a'.repeat(64),body=Buffer.alloc(300*1024,97);
const hash=createHash('sha256').update(body).digest('hex');
function observation(){return {owner,businessRevision:1,currentVerification:'valid',publication:{status:'committed',current:true,operationId:'operation',fullTupleHash:tupleHash}};}
function page(offset=0){const bytes=body.subarray(offset,offset+262144);return {owner,businessRevision:1,operationId:'operation',fullTupleHash:tupleHash,payloadHash:hash,totalBytes:body.length,offset,bytes:bytes.toString('base64'),eof:offset+bytes.length===body.length};}
it('uses the authenticated first page and binds every subsequent original request to that observation',async()=>{
 const calls:unknown[]=[];
 const client=createPublicationClient({owner,requestSource:'scheduler',transport:{async call(method,payload){calls.push({method,payload});return method==='publication.readCurrentOwnerPayload'?{observation:observation(),page:page()}:page(262144);}}});
 const result=await client.readCurrentPayload();expect(result.observation).toEqual(observation());expect(result.payload?.bytes).toEqual(body);
 expect(calls).toEqual([{method:'publication.readCurrentOwnerPayload',payload:{ownerKind:'loop',ownerId:'loop'}},{method:'publication.readOwnerPayload',payload:{ownerKind:'loop',ownerId:'loop',operationId:'operation',fullTupleHash:tupleHash,offset:262144,maxBytes:262144}}]);
 expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.observation)).toBe(true);
});
it.each(['task','intent','goal','project'] as const)('rejects a bound %s before issuing the loop-only RPC',async ownerKind=>{
 let calls=0;const client=createPublicationClient({owner:{...owner,ownerKind},requestSource:'user',transport:{async call(){calls++;throw Error('must not call');}}});
 await expect(client.readCurrentPayload()).rejects.toThrow('publication_client_owner');expect(calls).toBe(0);
});
it.each(['absent','unknown','cancelled','stale','unavailable'] as const)('preserves negative %s only with a null payload page',async mode=>{
 const observed:any=observation();if(mode==='absent')observed.publication={status:'absent'};
 else if(mode==='unavailable'){observed.currentVerification='unavailable';observed.publication.current=false;}
 else {observed.publication.current=false;if(mode!=='stale')observed.publication.status=mode;}
 let responsePage:unknown=null;
 const client=createPublicationClient({owner,requestSource:'user',transport:{async call(){return {observation:observed,page:responsePage};}}});
 expect(await client.readCurrentPayload()).toEqual({observation:observed,payload:null});
 responsePage=page();await expect(client.readCurrentPayload()).rejects.toThrow('publication_client_payload_page');
});
it.each(['null','owner','profile','revision','operation','tuple','offset','total','base64','eof','hash','extended-page','extended-envelope','crossed-observation','mixed-tail'] as const)('rejects crossed or malformed current payload: %s',async mode=>{
 const observed:any=observation(),first:any=page();let count=0;
 if(mode==='owner')first.owner={...owner,ownerId:'other'};
 if(mode==='profile')first.owner={...owner,profileId:'other'};
 if(mode==='revision')first.businessRevision++;
 if(mode==='operation')first.operationId='other';
 if(mode==='tuple')first.fullTupleHash='b'.repeat(64);
 if(mode==='offset')first.offset=1;
 if(mode==='total')first.totalBytes=32*1024**2+1;
 if(mode==='base64')first.bytes+='\n';
 if(mode==='eof')first.eof=true;
 if(mode==='hash')first.payloadHash='b'.repeat(64);
 if(mode==='extended-page')first.grant=true;
 if(mode==='crossed-observation')observed.owner={...owner,ownerId:'other'};
 const client=createPublicationClient({owner,requestSource:'user',transport:{async call(method){count++;if(method==='publication.readCurrentOwnerPayload')return {observation:observed,page:mode==='null'?null:first,...(mode==='extended-envelope'?{grant:true}:{})};return {...page(262144),...(mode==='mixed-tail'?{fullTupleHash:'c'.repeat(64)}:{})};}}});
 await expect(client.readCurrentPayload()).rejects.toThrow(/publication_client_/);expect(count).toBeLessThanOrEqual(2);
});
it('rejects a cancelled first-page response before yielding any payload',async()=>{
 const abort=new AbortController(),reason=Error('cancelled current page');let calls=0;
 const client=createPublicationClient({owner,requestSource:'user',transport:{async call(){calls++;abort.abort(reason);return {observation:observation(),page:page()};}}});
 await expect(client.readCurrentPayload(abort.signal)).rejects.toBe(reason);expect(calls).toBe(1);
});
