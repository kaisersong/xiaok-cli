import {parseMetadataCapacityPrepare,parseMetadataCapacityConfirm,parseMetadataCapacityQuery,parseMetadataCapacityAllocation,type AuthenticatedMetadataCapacityTransport} from './metadata-capacity-protocol.js';
/** Authenticated allocation facts only; the private Main owner must separately
 * bind actual custody/census and apply the actual connection cap before writing. */
export function createMetadataCapacityClient(transport:AuthenticatedMetadataCapacityTransport){
 const call=transport.call.bind(transport),sync=transport.callSync.bind(transport);
 function prepared(raw:unknown,p:ReturnType<typeof parseMetadataCapacityPrepare>){const value=result(raw,p);if(value.resourceRevision!==p.expectedRevision+1||value.usableMaximumPageCount<p.minimumPageCount)throw Error('metadata_capacity_response_grant');return value;}
 function result(raw:unknown,request:{resourceId:string;requestId?:string;intentId?:string;allocationDigest?:string}){const value=parseMetadataCapacityAllocation(raw);if(value.resourceId!==request.resourceId||request.requestId!==undefined&&value.requestId!==request.requestId||request.intentId!==undefined&&value.intentId!==request.intentId||request.allocationDigest!==undefined&&value.allocationDigest!==request.allocationDigest)throw Error('metadata_capacity_response_binding');return value;}
 return Object.freeze({
  async prepare(raw:unknown,signal?:AbortSignal){const p=parseMetadataCapacityPrepare(raw);return prepared(await call('capacity.metadata.prepare',p,signal),p);},
  prepareSync(raw:unknown){const p=parseMetadataCapacityPrepare(raw);return prepared(sync('capacity.metadata.prepare',p),p);},
  async confirm(raw:unknown,signal?:AbortSignal){const p=parseMetadataCapacityConfirm(raw);return result(await call('capacity.metadata.confirm',p,signal),p);},
  confirmSync(raw:unknown){const p=parseMetadataCapacityConfirm(raw);return result(sync('capacity.metadata.confirm',p),p);},
  async query(raw:unknown,signal?:AbortSignal){const p=parseMetadataCapacityQuery(raw);return result(await call('capacity.metadata.query',p,signal),p);},
  querySync(raw:unknown){const p=parseMetadataCapacityQuery(raw);return result(sync('capacity.metadata.query',p),p);},
 });
}
