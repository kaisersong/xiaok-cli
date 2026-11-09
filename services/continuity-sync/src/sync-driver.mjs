import { canonical,exactObject,hash,identifier,integer,parseCanonical } from './crypto.mjs';
import { validateCoordinatorIdentity } from './identity.mjs';
import { verifyCatchUp } from './receiver.mjs';

function snapshot(value){return parseCanonical(Buffer.from(canonical(value)));}
function equal(a,b){if(canonical(a)!==canonical(b))throw new Error('head_changed');}
function head(value,identity){exactObject(value,['identityHash','sequence','hash']);integer(value.sequence);if(value.identityHash!==hash(identity)||!/^[a-f0-9]{64}$/.test(value.hash))throw new Error('invalid_head');}

/** Read-only bounded catch-up. Never decrypts, grants execution, advances an OS floor,
 * imports canonical data, retries mutations, or returns a partial catch-up. */
export async function fetchVerifiedScope({client,identity,deviceId,scope,minimumHead,pageSize=100,maxRecords=100_000,maxBytes=64*1024*1024}){
  // Freeze every authority/limit input before the first network await.
  identity=validateCoordinatorIdentity(identity).identity;identifier(deviceId);scope=snapshot(scope);exactObject(scope,['conversationId','branchId']);identifier(scope.conversationId);identifier(scope.branchId);
  if(minimumHead!==undefined){minimumHead=snapshot(minimumHead);head(minimumHead,identity);}
  integer(pageSize,1);integer(maxRecords,1);integer(maxBytes,1);if(pageSize>100||maxRecords>1_000_000||maxBytes>1024**3)throw new Error('sync_limit');
  const first=await client.getHead({expectedHead:minimumHead}),target=snapshot(first.response.body.result.head);head(target,identity);
  if(target.sequence>maxRecords)throw new Error('sync_limit');
  let records=0,bytes=0;const commitments=[],controlEntries=[],privateEntries=[];
  function append(destination,values){for(const raw of values){const encoded=canonical(raw);bytes+=Buffer.byteLength(encoded);if(++records>maxRecords||bytes>maxBytes)throw new Error('sync_limit');destination.push(parseCanonical(Buffer.from(encoded)));}}
  for(const [route,destination,filtered]of [['/v1/journal/pull',commitments,false],['/v1/control/pull',controlEntries,true],['/v1/events/pull',privateEntries,true]]){
    let after=0,limit=pageSize;
    while(after<target.sequence){
      let response;
      try{response=await client.call(route,{...(route==='/v1/events/pull'?scope:{}),after,limit,targetHead:target},{expectedHead:target,requestSource:'user'});}
      catch(e){if(e.message!=='response_too_large'||limit===1)throw e;limit=Math.max(1,Math.floor(limit/2));continue;}
      equal(response.body.journalHead,target);const result=response.body.result;exactObject(result,filtered?['entries','scannedUntil','targetHead']:['entries','targetHead']);equal(result.targetHead,target);
      if(!Array.isArray(result.entries)||result.entries.length>limit)throw new Error('invalid_page');
      const scanned=filtered?result.scannedUntil:result.entries.at(-1)?.sequence;integer(scanned,1);
      if(scanned<=after||scanned>target.sequence||scanned>after+limit)throw new Error('invalid_page');
      let previous=after;
      for(const entry of result.entries){const sequence=filtered?entry.entry?.sequence:entry.sequence;integer(sequence,1);if(sequence<=previous||sequence>scanned||(!filtered&&sequence!==previous+1))throw new Error('invalid_page');previous=sequence;}
      // Do not append or move the cursor until the whole page passes its boundaries.
      append(destination,result.entries);after=scanned;
    }
  }
  const final=await client.getHead({expectedHead:target});
  return verifyCatchUp({identity,deviceId,scope,firstNonce:first.nonce,firstHead:first.response,finalNonce:final.nonce,finalHead:final.response,commitments,controlEntries,privateEntries,...(minimumHead?{minimumHead}:{})});
}
