import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';

// Pure bounded data validation. Nothing returned by this module is a stage,
// authenticated incoming receipt, publication capability or execution proof.
const id=z.string().min(1).max(256).refine(value=>!/[\u0000-\u001f]/u.test(value));
const hex=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const timestamp=z.number().int().min(0).max(8640000000000000);
const sourceKind=z.enum(['desktop_task','cli_session','native_codex','room']);
const scopeSchema=z.object({rootKeyId:id,syncGroupId:id,logicalProfileId:id,conversationId:id,branchId:id}).strict();
const linkSchema=z.object({messageId:id,revision:positive,contentHash:hex,originHash:hex}).strict();
const dependencyBase=z.object({scope:scopeSchema,sourceKind,sourceId:id,sourceEpoch:id,versions:z.array(linkSchema).min(1).max(1000)});
const dependencySchema=z.discriminatedUnion('kind',[
 dependencyBase.extend({kind:z.literal('history')}).strict(),
 dependencyBase.extend({kind:z.literal('reference'),reference:z.object({refId:z.string().regex(/^[A-Za-z0-9_-]{32}$/),snapshotRevision:z.number().int().min(0),contentHash:hex,grantId:id,grantRevision:positive}).strict()}).strict(),
]);
const versionSchema=z.object({revision:positive,sourceRevision:positive,role:z.enum(['user','assistant','tool_summary']),text:z.string(),contentHash:hex,originHash:hex,
 dependencies:z.array(dependencySchema).max(128),observedAt:timestamp,executionObservation:z.enum(['pending','settled','unknown'])}).strict();
const messageSchema=z.object({messageId:id,sequence:positive,sourceKind,sourceId:id,sourceEpoch:id,sourceMessageId:id,versions:z.array(versionSchema).min(1).max(1000)}).strict();
const entrySchema=z.object({messageId:id,revision:positive,contentHash:hex}).strict();
const referenceSchema=z.object({refId:z.string().regex(/^[A-Za-z0-9_-]{32}$/),snapshotRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),contentHash:hex,entries:z.array(entrySchema).min(1).max(1000)}).strict();
const unavailableProjection=z.object({state:z.literal('unavailable')}).strict();
const batchSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('canonical-batch-v1'),scope:scopeSchema,
 conversation:z.object({title:z.string().max(1024).nullable(),mode:z.enum(['chat','work']),createdAt:timestamp,updatedAt:timestamp,revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),coverage:z.enum(['complete','partial'])}).strict(),
 messages:z.array(messageSchema).max(1000),references:z.array(referenceSchema).max(1000),
 grants:z.array(z.object({grantId:id,refId:z.string().regex(/^[A-Za-z0-9_-]{32}$/),targetConversationId:id,revision:positive,revoked:z.boolean()}).strict()).max(1000),
 coverage:z.object({firstSequence:z.number().int().min(0),lastSequence:z.number().int().min(0),anchorCount:z.number().int().min(0),versionCount:z.number().int().min(0)}).strict(),
 inputProjection:unavailableProjection,checkpointProjection:unavailableProjection,decisionProjection:unavailableProjection,manifestHash:hex,
}).strict();
export type CanonicalSyncScope=z.infer<typeof scopeSchema>;
export type CanonicalSyncBatch=z.infer<typeof batchSchema>;
type Message=CanonicalSyncBatch['messages'][number];
type Version=Message['versions'][number];
const invalid=()=>new Error('canonical_batch_invalid');
function normalized(value:unknown):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
function digest(value:unknown):string{return createHash('sha256').update(normalized(value)).digest('hex');}
function textDigest(text:string):string{return createHash('sha256').update(text).digest('hex');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function plain(input:unknown):unknown {
 const seen=new Set<object>();let objects=0,bytes=0;
 const visit=(value:unknown,depth:number):unknown=>{
  if(typeof value==='string'){bytes+=Buffer.byteLength(value);if(bytes>512*1024)throw new Error('snapshot_chunking_required');return value;}
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||types.isProxy(value)||seen.has(value)||++objects>8000||depth>24||Object.getOwnPropertySymbols(value).length)throw invalid();
  seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Array.isArray(value)){
   if(value.length>5000||Object.keys(descriptors).length!==value.length+1)throw invalid();
   const result=[];for(let i=0;i<value.length;i++){const item=descriptors[String(i)];if(!item?.enumerable||!('value'in item))throw invalid();result.push(visit(item.value,depth+1));}return result;
  }
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
  const result:Record<string,unknown>=Object.create(null);
  for(const [key,item]of Object.entries(descriptors)){if(key==='then'||!item.enumerable||!('value'in item))throw invalid();bytes+=Buffer.byteLength(key);result[key]=visit(item.value,depth+1);}return result;
 };
 const result=visit(input,0);if(Buffer.byteLength(JSON.stringify(result))>512*1024)throw new Error('snapshot_chunking_required');return result;
}
/** Producer hash only, no authority. Observations are deliberately excluded. */
export function canonicalVersionDigest(scope:CanonicalSyncScope,message:Pick<Message,'messageId'|'sequence'|'sourceKind'|'sourceId'|'sourceEpoch'|'sourceMessageId'>,version:Pick<Version,'revision'|'sourceRevision'|'role'|'text'|'contentHash'|'dependencies'>):string {
 return digest(['xiaok/canonical-version/v1',scope,message.messageId,message.sequence,message.sourceKind,message.sourceId,message.sourceEpoch,message.sourceMessageId,version.revision,version.sourceRevision,version.role,version.text,version.contentHash,version.dependencies]);
}
export function validateCanonicalBatch(input:unknown,expected:CanonicalSyncScope):Readonly<CanonicalSyncBatch>{
 try{
  const batch=batchSchema.parse(plain(input)),scope=scopeSchema.parse(plain(expected));
  if(normalized(batch.scope)!==normalized(scope))throw invalid();
  const messages=new Map<string,Message>(),sourceMessages=new Set<string>();let versions=0;
  for(const [index,message]of batch.messages.entries()){
   const source=normalized([message.sourceKind,message.sourceId,message.sourceEpoch,message.sourceMessageId]);
   if(message.sequence!==index+1||messages.has(message.messageId)||sourceMessages.has(source))throw invalid();
   sourceMessages.add(source);messages.set(message.messageId,message);let prior=0;
   for(const [at,version]of message.versions.entries()){
    if(++versions>5000||version.revision!==at+1||version.sourceRevision<=prior||textDigest(version.text)!==version.contentHash||canonicalVersionDigest(batch.scope,message,version)!==version.originHash)throw invalid();
    prior=version.sourceRevision;
    const deps=new Set<string>();for(const dep of version.dependencies){const key=normalized(dep);if(deps.has(key))throw invalid();deps.add(key);}
   }
  }
  const coverage=batch.coverage;
  if(coverage.firstSequence!==(messages.size?1:0)||coverage.lastSequence!==messages.size||coverage.anchorCount!==messages.size||coverage.versionCount!==versions)throw invalid();
  const refs=new Map<string,CanonicalSyncBatch['references'][number]>();
  for(const ref of batch.references){
   if(refs.has(ref.refId)||ref.snapshotRevision>batch.conversation.revision)throw invalid();refs.set(ref.refId,ref);let previous=0;
   for(const entry of ref.entries){const message=messages.get(entry.messageId),version=message?.versions[entry.revision-1];if(!message||!version||version.contentHash!==entry.contentHash||message.sequence<=previous)throw invalid();previous=message.sequence;}
   if(digest(ref.entries.map(entry=>[entry.messageId,entry.revision,entry.contentHash]))!==ref.contentHash)throw invalid();
  }
  const grants=new Set<string>();for(const grant of batch.grants){if(grants.has(grant.grantId)||!refs.has(grant.refId))throw invalid();grants.add(grant.grantId);}
  const {manifestHash,...body}=batch;if(digest(['xiaok/canonical-batch/v1',body])!==manifestHash)throw invalid();
  return freeze(batch);
 }catch(error){if(error instanceof Error&&error.message==='snapshot_chunking_required')throw error;throw invalid();}
}

/** All ancestors must be selected and validated at the same original capture
 * head by the caller. This pure closure check never authenticates that head. */
export function validateCanonicalBundle(input:readonly CanonicalSyncBatch[]):ReadonlyArray<Readonly<CanonicalSyncBatch>>{
 const unavailable=()=>new Error('canonical_dependency_unavailable');
 if(!Array.isArray(input)||types.isProxy(input)||Object.getOwnPropertySymbols(input).length)throw unavailable();
 const descriptors=Object.getOwnPropertyDescriptors(input as object),length=descriptors.length.value;
 if(typeof length!=='number'||length<1||length>16||Object.keys(descriptors).length!==length+1)throw unavailable();
 const batches:CanonicalSyncBatch[]=[];
 for(let i=0;i<length;i++){
  const descriptor=descriptors[String(i)];if(!descriptor?.enumerable||!('value'in descriptor))throw unavailable();
  // Each scope is read only from its own bounded plain clone. Do not run the
  // 512KiB single-batch budget over the entire permitted 8MiB bundle.
  const safe=plain(descriptor.value)as CanonicalSyncBatch;
  if(!safe||typeof safe!=='object')throw unavailable();batches.push(validateCanonicalBatch(safe,safe.scope));
 }
 const scopes=new Map<string,CanonicalSyncBatch>(),nodes=new Map<string,{batch:CanonicalSyncBatch;message:Message;version:Version}>();
 const nodeKey=(scope:CanonicalSyncScope,messageId:string,revision:number)=>normalized([scope,messageId,revision]);
 let bytes=0;
 for(const batch of batches){
  bytes+=Buffer.byteLength(normalized(batch));if(bytes>8*1024*1024)throw unavailable();
  const key=normalized(batch.scope),first=batches[0].scope;
  if(scopes.has(key)||batch.scope.rootKeyId!==first.rootKeyId||batch.scope.syncGroupId!==first.syncGroupId||batch.scope.logicalProfileId!==first.logicalProfileId)throw unavailable();scopes.set(key,batch);
  for(const message of batch.messages)for(const version of message.versions)nodes.set(nodeKey(batch.scope,message.messageId,version.revision),{batch,message,version});
 }
 const edges=new Map<string,string[]>();
 for(const [key,{batch,version}]of nodes){const links:string[]=[];
  const referenceGroups=new Map<string,{reference:CanonicalSyncBatch['references'][number];positions:Set<number>}>();
  for(const dep of version.dependencies){
   const ancestor=scopes.get(normalized(dep.scope));if(!ancestor)throw unavailable();
   const seen=new Set<string>();for(const entry of dep.versions){
    const target=nodeKey(dep.scope,entry.messageId,entry.revision),node=nodes.get(target);
    if(seen.has(target)||!node||node.message.sourceKind!==dep.sourceKind||node.message.sourceId!==dep.sourceId||node.message.sourceEpoch!==dep.sourceEpoch||node.version.contentHash!==entry.contentHash||node.version.originHash!==entry.originHash)throw unavailable();seen.add(target);links.push(target);
   }
   if(dep.kind==='reference'){
    const ref=ancestor.references.find(ref=>ref.refId===dep.reference.refId),grant=ancestor.grants.find(grant=>grant.grantId===dep.reference.grantId);
    if(!ref||ref.contentHash!==dep.reference.contentHash||ref.snapshotRevision!==dep.reference.snapshotRevision||!grant||grant.revoked||grant.revision!==dep.reference.grantRevision||grant.refId!==ref.refId||grant.targetConversationId!==batch.scope.conversationId)throw unavailable();
    // One original ref may span several source tasks. Group the exact source
    // manifests for THIS derived version, then require their union to cover
    // every ordered entry of that same immutable ref and original grant.
    const groupKey=normalized([dep.scope,dep.reference]);let group=referenceGroups.get(groupKey);
    if(!group){group={reference:ref,positions:new Set()};referenceGroups.set(groupKey,group);}
    let prior=-1;
    for(const entry of dep.versions){const position=ref.entries.findIndex(item=>item.messageId===entry.messageId&&item.revision===entry.revision&&item.contentHash===entry.contentHash);if(position<0||position<=prior||group.positions.has(position))throw unavailable();group.positions.add(position);prior=position;}
   }
  }
  for(const group of referenceGroups.values())if(group.positions.size!==group.reference.entries.length)throw unavailable();
  edges.set(key,links);
 }
 const complete=new Set<string>(),visiting=new Set<string>();let traversals=0;
 const visit=(key:string,depth:number)=>{if(complete.has(key))return;if(visiting.has(key)||depth>128||++traversals>80000)throw unavailable();visiting.add(key);for(const child of edges.get(key)??[])visit(child,depth+1);visiting.delete(key);complete.add(key);};
 for(const key of nodes.keys())visit(key,0);
 return Object.freeze(batches);
}
