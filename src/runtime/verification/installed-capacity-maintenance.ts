import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertInstalledRootBrokerClient,type createInstalledRootBrokerClient} from './root-broker-client.js';
import {assertSharedBlobCapacityDatabase,type createSharedBlobCapacity} from './shared-blob-capacity.js';
import {canonicalVerificationJson as json} from './protocol.js';
import type {ControllerPeer} from './controller-public-daemon.js';
type PageRequest={requestSource:'user';ownerKind:string;ownerId:string;after:string|null;limit:number};
/** Read-only metadata projection, not an authorization issuer. The installed
 * facade resolves the kernel peer through the actual broker before calling it. */
export function readExistingMaintenancePage(db:Database,principal:{uid:number;accountGeneration:string},request:PageRequest){
 if(request.requestSource!=='user'||!['task','intent','goal','loop','project'].includes(request.ownerKind)||typeof request.ownerId!=='string'||!request.ownerId||request.ownerId.length>160||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>64||request.after!==null&&(typeof request.after!=='string'||request.after.length>160))throw Error('maintenance_request');
 try{
 const profile=db.prepare('SELECT uid,account_id,profile_id,state FROM verification_profiles WHERE uid=?').get(principal.uid) as {uid:number;account_id:string;profile_id:string;state:string}|undefined;
 if(!profile||profile.state!=='active'||profile.account_id!==principal.accountGeneration.toLowerCase())throw Error();
 const ownerKey=json({profileId:profile.profile_id,ownerKind:request.ownerKind,ownerId:request.ownerId});const owner=db.prepare('SELECT state FROM verification_registered_owners WHERE owner_key=? AND uid=?').get(ownerKey,principal.uid) as {state:string}|undefined;
 if(!owner||owner.state!=='active')throw Error();
 const invocations=db.prepare('SELECT invocation_json,state FROM verification_registered_invocations WHERE owner_key=? AND profile_id=? LIMIT 131073').all(ownerKey,profile.profile_id) as {invocation_json:string;state:string}[];
 if(!invocations.length||invocations.length>131072)throw Error();for(const row of invocations){const invocation=JSON.parse(row.invocation_json);if(row.state!=='active'||!invocation||Object.keys(invocation).sort().join(',')!=='compoundOperationId,sessionIdentity,validationInvocationId'||Object.values(invocation).some(value=>typeof value!=='string'||!value||value.length>160||/[\x00-\x1f\x7f]/.test(value))||json(invocation)!==row.invocation_json)throw Error();}
 const hasBindings=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shared_blob_bindings'").get();
 const inventory=db.prepare('SELECT resource_id,state,tuple_json FROM verification_blob_reservations WHERE owner_key=? ORDER BY resource_id LIMIT 131073').all(ownerKey) as {resource_id:string;state:string;tuple_json:string}[];const bindings=hasBindings?db.prepare('SELECT b.resource_id,b.allocation_hash,b.binding_json FROM shared_blob_bindings b JOIN verification_blob_reservations r ON r.resource_id=b.resource_id WHERE r.owner_key=? ORDER BY b.resource_id LIMIT 131073').all(ownerKey) as {resource_id:string;allocation_hash:string;binding_json:string}[]:[];const encoded=json({inventory,bindings});if(inventory.length>131072||Buffer.byteLength(encoded)>128*1024**2)throw Error();const inventoryDigest=createHash('sha256').update(encoded).digest('hex'),rows=inventory.filter(row=>row.resource_id>(request.after??'')).slice(0,request.limit+1);
 const items=rows.slice(0,request.limit).map(row=>{const value=JSON.parse(row.tuple_json);if(typeof row.resource_id!=='string'||row.resource_id.length>160||!['reserved','released'].includes(row.state)||!['host-staging','guest-input','guest-output','host-export'].includes(value.kind))throw Error();const binding=bindings.find(b=>b.resource_id===row.resource_id),mapped=!!binding;if(binding){const facts=JSON.parse(binding.binding_json);if(binding.allocation_hash!==createHash('sha256').update(json(value)).digest('hex')||facts.ownerKey!==ownerKey||facts.scopeDigest!==value.scopeDigest||facts.bytes!==value.bytes||typeof facts.sessionKey!=='string'||!/^[a-f0-9]{64}$/.test(facts.sessionKey))throw Error();}return Object.freeze({resourceId:row.resource_id,kind:value.kind as string,state:row.state,mapping:mapped?'mapped':'unmapped',reason:mapped?null:'capacity_mapping_missing'});});
 return Object.freeze({inventoryDigest,items:Object.freeze(items),nextAfter:rows.length>request.limit?items[items.length-1].resourceId:null});
 }catch{throw Error('maintenance_owner_unavailable');}
}
export function createInstalledCapacityMaintenance(input:{lifetime:InstalledControllerLifetime;broker:ReturnType<typeof createInstalledRootBrokerClient>;capacity:ReturnType<typeof createSharedBlobCapacity>}){
 const {lifetime,broker,capacity}=input;assertInstalledControllerLifetime(lifetime);const db=lifetime.database,authorityId=lifetime.manifest.authorityId;
 assertInstalledRootBrokerClient(broker,lifetime);assertSharedBlobCapacityDatabase(capacity,db,authorityId);
 const resolve=broker.resolvePrincipal.bind(broker),migrate=capacity.migrateLegacy.bind(capacity),diagnoseLegacy=capacity.diagnoseLegacy.bind(capacity),cursors=new Map<string,{principal:string;owner:string;after:string;inventoryDigest:string}>();let closed=false,busy=false;
 function current(){if(closed)throw Error('maintenance_closed');assertInstalledControllerLifetime(lifetime);assertInstalledRootBrokerClient(broker,lifetime);assertSharedBlobCapacityDatabase(capacity,db,authorityId);}
 return Object.freeze({
 publicPort:Object.freeze({diagnose(raw:unknown,peerInput:ControllerPeer,signal:AbortSignal){current();signal.throwIfAborted();if(busy||db.inTransaction)throw Error('maintenance_busy');busy=true;try{
 const serialized=json(raw);if(Buffer.byteLength(serialized)>4096)throw Error('maintenance_request');const request=JSON.parse(serialized);if(!request||Object.keys(request).sort().join(',')!=='cursor,limit,ownerId,ownerKind,requestSource')throw Error('maintenance_request');
 const peer=Object.freeze({...peerInput}),principal=resolve(peer),identity=json(principal),owner=json([request.ownerKind,request.ownerId]);let after:string|null=null;
 if(request.cursor!==null){const saved=cursors.get(request.cursor);if(!saved||saved.principal!==identity||saved.owner!==owner)throw Error('maintenance_cursor');after=saved.after;}
 const page=readExistingMaintenancePage(db,principal,{...request,after});if(request.cursor!==null&&cursors.get(request.cursor)?.inventoryDigest!==page.inventoryDigest)throw Error('maintenance_changed');current();signal.throwIfAborted();if(json(resolve(peer))!==identity)throw Error('maintenance_owner_unavailable');
 // Re-read after native identity work, which can yield to external DB writers.
 if(json(readExistingMaintenancePage(db,principal,{...request,after}))!==json(page))throw Error('maintenance_changed');
 if(page.nextAfter&&request.cursor===null&&cursors.size>=64)throw Error('maintenance_cursor_capacity');let nextCursor:string|null=null;if(page.nextAfter){nextCursor=randomUUID();cursors.set(nextCursor,{principal:identity,owner,after:page.nextAfter,inventoryDigest:page.inventoryDigest});}if(request.cursor!==null)cursors.delete(request.cursor);
 const result=Object.freeze({mode:'maintenance' as const,items:page.items,nextCursor,unmappedInventoryPresent:diagnoseLegacy().length>0});if(Buffer.byteLength(json(result))>65536)throw Error('maintenance_page');return result;
 }finally{busy=false;}}}),
 privateHost:Object.freeze({retryMigration(){current();if(busy||db.inTransaction)throw Error('maintenance_busy');busy=true;try{const result=migrate();current();return result;}finally{busy=false;}}}),
 async close(){closed=true;cursors.clear();},
 });
}
