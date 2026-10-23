import type {createCompositeEgressService} from './composite-egress-service.js';
/** Bounded request and response transfer for the original one-attempt owner. */
export function createCompositeEgressDispatch(actual:ReturnType<typeof createCompositeEgressService>){
  const outputs=new Map<string,{status:number;bytes:Buffer}|null>(),uploads=new Map<string,{totalBytes:number;parts:Buffer[];offset:number}>();
  return async (request:any)=>{
   if(request.method==='beginBody'){if(typeof request.attemptId!=='string'||!request.attemptId||request.attemptId.length>256||uploads.size>=4||uploads.has(request.attemptId)||!Number.isSafeInteger(request.totalBytes)||request.totalBytes<0||request.totalBytes>16*1024**2)throw Error('egress_body_capacity');uploads.set(request.attemptId,{totalBytes:request.totalBytes,parts:[],offset:0});return {offset:0};}
   if(request.method==='appendBody'){const upload=uploads.get(request.attemptId);if(!upload||request.offset!==upload.offset||typeof request.bytesBase64!=='string'||request.bytesBase64.length>349528)throw Error('egress_body_chunk');const bytes=Buffer.from(request.bytesBase64,'base64');if(bytes.toString('base64')!==request.bytesBase64||!bytes.length||bytes.length>256*1024||upload.offset+bytes.length>upload.totalBytes)throw Error('egress_body_chunk');upload.parts.push(bytes);upload.offset+=bytes.length;return {offset:upload.offset};}
   if(request.method==='discardBody'){const upload=uploads.get(request.attemptId);if(upload)for(const part of upload.parts)part.fill(0);uploads.delete(request.attemptId);return {discarded:true};}
   if(request.method==='prepare')return actual.prepare(request.attempt,Buffer.from(request.receipt,'base64'));
   if(request.method==='dispatch'){
    if(outputs.size>=4||outputs.has(request.attemptId))throw Error('egress_output_capacity');outputs.set(request.attemptId,null);
    try{let body=request.body;const upload=uploads.get(request.attemptId);if(upload){if(body!==undefined||upload.offset!==upload.totalBytes)throw Error('egress_body_incomplete');const bytes=Buffer.concat(upload.parts);body=bytes.toString('utf8');if(!Buffer.from(body).equals(bytes))throw Error('egress_body_utf8');bytes.fill(0);for(const part of upload.parts)part.fill(0);uploads.delete(request.attemptId);}const result=await actual.dispatch(request.attemptId,body),bytes=Buffer.from(result.body);outputs.set(request.attemptId,{status:result.status,bytes});return {attemptId:request.attemptId,status:result.status,totalBytes:bytes.length};}catch(error){outputs.delete(request.attemptId);throw error;}
   }
   if(request.method==='readResponse'){const output=outputs.get(request.attemptId);if(!output)throw Error('egress_output_not_available');const offset=request.offset;if(!Number.isSafeInteger(offset)||offset<0||offset>output.bytes.length)throw Error('egress_output_offset');return {status:output.status,totalBytes:output.bytes.length,offset,bytesBase64:output.bytes.subarray(offset,offset+256*1024).toString('base64')};}
   if(request.method==='releaseResponse'){const output=outputs.get(request.attemptId);if(!output)throw Error('egress_output_not_available');output.bytes.fill(0);outputs.delete(request.attemptId);return {released:true};}
   if(request.method==='query')return {record:actual.query(request.attemptId),responseAvailable:Boolean(outputs.get(request.attemptId))};
   if(request.method==='cancel')return actual.cancel(request.attemptId);throw Error('egress_method');
  };
}
