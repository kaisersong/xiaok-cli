import {basename} from 'node:path';
import {consumeBlobCommandContext} from '../verification/blob-budget.js';
import type {CapacityWriteContext,PreparedCapacityCommandFacts} from '../verification/capacity-command.js';
import {createArtifactCapacityBinding} from '../verification/shared-blob-capacity.js';
const artifactPrepareCommands=new WeakMap<object,{database:Database;budget:object;allocation:Readonly<BlobReservationProposal>;recordJson:string;capacityBinding:object}>();
export function inspectArtifactPrepareCommand(command:object,budget:object,database:Database):Readonly<PreparedCapacityCommandFacts>|undefined{const facts=artifactPrepareCommands.get(command);if(!facts)return undefined;if(facts.database!==database||facts.budget!==budget)throw Error('capacity_command_owner');return Object.freeze({allocations:Object.freeze([facts.allocation]),capacityBinding:facts.capacityBinding});}
export function executeArtifactPrepareCommand(command:object,context:CapacityWriteContext):boolean{const facts=artifactPrepareCommands.get(command);if(!facts)return false;const {database:db,budget,allocation,recordJson}=facts;const tickets=consumeBlobCommandContext(context,budget,db,command);if(tickets.length!==1||!tickets[0]!.created)throw Error('artifact_resource_replay');assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(recordJson)+2048});db.prepare("INSERT INTO verification_artifact_batches VALUES(?,?,'prepared',?)").run(allocation.resourceId,allocation.ownerKey,recordJson);return true;}
const BLOCK=512,MAX_FILE=16*1024**2,MAX_ARCHIVE=MAX_FILE+16384;
function number(field:Buffer):number{const text=field.toString('ascii');if(!/^[ \0]*[0-7]*[ \0]*$/.test(text))throw Error('artifact_tar_number');const clean=text.replace(/[ \0]/g,'');const value=clean?Number.parseInt(clean,8):0;if(!Number.isSafeInteger(value)||value<0)throw Error('artifact_tar_number');return value;}
function text(field:Buffer):string{const nul=field.indexOf(0),data=nul<0?field:field.subarray(0,nul);if(nul>=0&&field.subarray(nul).some(x=>x!==0))throw Error('artifact_tar_text');try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw Error('artifact_tar_text');}}
function requested(path:string):string{if(typeof path!=='string'||!path||Buffer.byteLength(path)>4096||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'||/[:\x00-\x1f\x7f]/.test(x)))throw Error('artifact_path');return basename(path);}
function pax(data:Buffer):Map<string,string>{
 const fields=new Map<string,string>();let offset=0;
 while(offset<data.length){const space=data.indexOf(32,offset);if(space<0||space-offset>8)throw Error('artifact_pax');const countText=data.subarray(offset,space).toString('ascii');if(!/^[1-9][0-9]*$/.test(countText))throw Error('artifact_pax');const length=Number(countText),end=offset+length;if(end>data.length||end<=space+2||data[end-1]!==10)throw Error('artifact_pax');const record=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(space+1,end-1)),equal=record.indexOf('=');if(equal<1)throw Error('artifact_pax');const key=record.slice(0,equal),value=record.slice(equal+1);if(fields.has(key)||!['path','mtime','atime','ctime'].includes(key))throw Error('artifact_pax_field');if(key!=='path'&&!/^-?[0-9]{1,12}(?:\.[0-9]{1,12})?$/.test(value))throw Error('artifact_pax_time');fields.set(key,value);offset=end;
 }return fields;
}
/** Parses untrusted Docker archive bytes. The qualified engine adapter must also
 * reject symlink ancestors with its actual HEAD/no-follow protocol; TAR alone
 * cannot attest which container path produced these bytes. No archive is extracted to disk.
 */
export function extractSingleArtifact(input:Buffer,relativePath:string):Buffer{
 const expected=requested(relativePath);
 if(!Buffer.isBuffer(input)||input.length>MAX_ARCHIVE||input.length%BLOCK!==0)throw Error('artifact_tar_limit');
 let offset=0,result:Buffer|undefined,extended:Map<string,string>|undefined;
 while(offset<input.length){
  const header=input.subarray(offset,offset+BLOCK);
  if(header.every(x=>x===0)){
   if(offset+2*BLOCK>input.length||input.subarray(offset).some(x=>x!==0))throw Error('artifact_tar_truncated');
   if(!result||extended)throw Error('artifact_tar_member');return result;
  }
  const checksum=number(header.subarray(148,156));let actual=0;for(let i=0;i<BLOCK;i++)actual+=i>=148&&i<156?32:header[i];if(actual!==checksum)throw Error('artifact_tar_checksum');
  const magic=header.subarray(257,263).toString('ascii');if(magic!=='ustar\0'&&magic!=='ustar ')throw Error('artifact_tar_format');
  const size=number(header.subarray(124,136)),type=header[156],start=offset+BLOCK,end=start+size,padded=start+Math.ceil(size/BLOCK)*BLOCK;
  if(size>MAX_FILE||padded>input.length)throw Error('artifact_tar_truncated');
  if(input.subarray(end,padded).some(x=>x!==0))throw Error('artifact_tar_padding');
  if(type===120){if(extended||result||size>4096)throw Error('artifact_pax');extended=pax(input.subarray(start,end));offset=padded;continue;}
  if(type!==0&&type!==48)throw Error('artifact_tar_regular_required');
  if(result)throw Error('artifact_tar_member');
  if(text(header.subarray(157,257)))throw Error('artifact_tar_regular_required');
  const prefix=text(header.subarray(345,500)),name=text(header.subarray(0,100));
  const resolved=extended?.get('path')??(prefix?prefix+'/'+name:name);
  if(resolved!==expected||resolved.includes('/')||resolved.includes('\\'))throw Error('artifact_tar_path');
  result=Buffer.from(input.subarray(start,end));extended=undefined;offset=padded;
 }
 throw Error('artifact_tar_truncated');
}

import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,realpathSync,openSync,constants,writeFileSync,fsyncSync,closeSync,readFileSync,fstatSync,readdirSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {canonicalVerificationJson} from '../verification/protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from '../verification/storage-budget.js';
import {assertVerificationBlobBudgetDatabase,type createVerificationBlobBudget,type BlobReservationProposal} from '../verification/blob-budget.js';
import type {QuiescenceAuthority,PhysicalQuiescenceReceipt,QuiescenceExpectation} from './physical-quiescence.js';
import {syncDirectoryTreeStrict} from '../../utils/atomic-file.js';
type Source='user'|'agent'|'scheduler';
interface ExportFact {ownerKey:string;expected:QuiescenceExpectation;paths:readonly string[]}
interface ArtifactFact {path:string;sha256:string;size:number;index:number}
interface Batch {resourceId:string;facts:ExportFact;artifacts:readonly ArtifactFact[];reservation:BlobReservationProposal}
interface ExportRow {state:'prepared'|'ready'|'deleted';manifest_json:string}
function snapshot<T>(raw:T):T{const text=canonicalVerificationJson(raw);if(Buffer.byteLength(text)>1024**2)throw Error('artifact_metadata_limit');const value=JSON.parse(text);const visit=(x:any)=>{if(x&&typeof x==='object'){Object.values(x).forEach(visit);Object.freeze(x);}};visit(value);return value;}
function synchronous(result:unknown){if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('artifact_authority_sync');}}
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
/** Private protected-service exporter. Opaque output binding and source authority
 * are verified by the actual runner/access owner, not by a container-id DTO.
 * Prepared failures retain their reservation until explicit authenticated cleanup.
 */
export function createArtifactExporter(options:{
 root:string;database:Database;budget:ReturnType<typeof createVerificationBlobBudget>;assertCurrent():void;
 quiescence:Pick<QuiescenceAuthority,'assertQuiescent'>;
 readArchive(output:object,relativePath:string,options:{expected:QuiescenceExpectation;signal?:AbortSignal}):Promise<Buffer>;
 access:{assertExport(facts:ExportFact,output:object,requestSource:Source):void;assertRead(facts:Batch,authorization:object):void;assertDelete(facts:Batch,authorization:object,requestSource:Source):void};
}){
 const {budget,assertCurrent,readArchive}=options,physical=options.quiescence.assertQuiescent.bind(options.quiescence);
 const access={assertExport:options.access.assertExport.bind(options.access),assertRead:options.access.assertRead.bind(options.access),assertDelete:options.access.assertDelete.bind(options.access)};
 const db=options.database;assertVerificationBlobBudgetDatabase(budget,db);budget.assertExternalOperationBoundary();let closed=false;mkdirSync(options.root,{recursive:true,mode:0o700});if(lstatSync(options.root).isSymbolicLink())throw Error('artifact_root');
 const root=join(realpathSync(options.root),'exports');if(!existsSync(root))mkdirSync(root,{mode:0o700});
 const identity=lstatSync(root);if(identity.isSymbolicLink()||!identity.isDirectory())throw Error('artifact_root');
 db.exec('CREATE TABLE IF NOT EXISTS verification_artifact_batches(resource_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,state TEXT NOT NULL,manifest_json TEXT NOT NULL)');
 const handles=new WeakMap<object,{batch:Batch;artifact:ArtifactFact;authorization:object}>(),deleted=new WeakMap<object,BlobReservationProposal>();
 function current(){if(closed)throw Error('artifact_exporter_closed');synchronous(assertCurrent());const now=lstatSync(root);if(now.isSymbolicLink()||!now.isDirectory()||now.dev!==identity.dev||now.ino!==identity.ino)throw Error('artifact_root');}
 function directory(resourceId:string){if(!/^[0-9a-f-]{36}$/.test(resourceId))throw Error('artifact_identity');return join(root,resourceId);}
 function load(resourceId:string,states:readonly string[]=['ready']):Batch{current();directory(resourceId);const row=db.prepare('SELECT state,manifest_json FROM verification_artifact_batches WHERE resource_id=?').get(resourceId) as ExportRow|undefined;if(!row||!states.includes(row.state))throw Error('artifact_unavailable');return snapshot(JSON.parse(row.manifest_json));}
 function safeDirectory(batch:Batch){const dir=directory(batch.resourceId),stat=lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('artifact_directory');return dir;}
 const deletionAuthority=Object.freeze({assertDeleted(proof:object,resource:Readonly<BlobReservationProposal>):void{
  current();const fact=deleted.get(proof);if(!fact||canonicalVerificationJson(fact)!==canonicalVerificationJson(resource)||existsSync(directory(resource.resourceId)))throw Error('artifact_deletion_receipt');
  const row=db.prepare('SELECT state FROM verification_artifact_batches WHERE resource_id=?').get(resource.resourceId) as {state:string}|undefined;if(row?.state!=='deleted')throw Error('artifact_deletion_receipt');
 }});
 return Object.freeze({
  deletionAuthority,
  async exportArtifacts(input:{requestSource:Source;ownerKey:string;output:object;expected:QuiescenceExpectation;receipt:PhysicalQuiescenceReceipt;paths:readonly string[];signal?:AbortSignal}):Promise<Readonly<{resourceId:string;artifacts:readonly Omit<ArtifactFact,'index'>[]}>>{
   budget.assertExternalOperationBoundary();
   const {output,receipt,signal,requestSource}=input;
   const facts=snapshot({ownerKey:input.ownerKey,expected:input.expected,paths:input.paths});
   if(!['user','agent','scheduler'].includes(requestSource)||typeof facts.ownerKey!=='string'||!facts.ownerKey||Buffer.byteLength(facts.ownerKey)>1024||!Array.isArray(facts.paths)||!facts.paths.length||facts.paths.length>4096||new Set(facts.paths.map(x=>x.toLowerCase())).size!==facts.paths.length)throw Error('artifact_export_request');facts.paths.forEach(requested);
   const live=()=>{budget.assertExternalOperationBoundary();current();signal?.throwIfAborted();synchronous(access.assertExport(facts,output,requestSource));synchronous(physical(receipt,facts.expected));signal?.throwIfAborted();budget.assertExternalOperationBoundary();};live();
   const content:Buffer[]=[],artifacts:ArtifactFact[]=[];let allocation=0;
   for(const path of facts.paths){live();const archive=await readArchive(output,path,{expected:facts.expected,signal});live();const data=extractSingleArtifact(archive,path);allocation+=Math.max(4096,Math.ceil(data.length/4096)*4096)*2;if(allocation>256*1024**2)throw Error('artifact_batch_capacity');content.push(data);artifacts.push({path,sha256:sha(data),size:data.length,index:artifacts.length});}
   live();const resourceId=randomUUID(),reservation=snapshot({ownerKey:facts.ownerKey,resourceId,kind:'host-export' as const,bytes:allocation,scopeDigest:facts.expected.scopeDigest});
   const batch:Batch=snapshot({resourceId,facts,artifacts,reservation}),json=canonicalVerificationJson(batch);
   const capacityBinding=createArtifactCapacityBinding({database:db,allocation:reservation});const command=Object.freeze({});artifactPrepareCommands.set(command,{database:db,budget,allocation:reservation,recordJson:json,capacityBinding});let allocationTicket:Readonly<{token:object;created:boolean}>;try{allocationTicket=budget.reserveCommand(command);}finally{artifactPrepareCommands.delete(command);}
   budget.assertReserved(allocationTicket.token,reservation);live();const dir=directory(resourceId);mkdirSync(dir,{mode:0o700});
   for(const artifact of artifacts){live();budget.assertReserved(allocationTicket.token,reservation);const fd=openSync(join(dir,artifact.index+'.blob'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o400);try{writeFileSync(fd,content[artifact.index]);fsyncSync(fd);}finally{closeSync(fd);}}
   syncDirectoryTreeStrict(dir);live();budget.assertReserved(allocationTicket.token,reservation);
   runVerificationTransaction(db,()=>{db.prepare("UPDATE verification_artifact_batches SET state='ready' WHERE resource_id=? AND state='prepared'").run(resourceId);});
   return snapshot({resourceId,artifacts:artifacts.map(({index,...fact})=>fact)});
  },
  openArtifact(resourceId:string,path:string,authorization:object):object{const batch=load(resourceId);requested(path);synchronous(access.assertRead(batch,authorization));const artifact=batch.artifacts.find(x=>x.path===path);if(!artifact)throw Error('artifact_path');const token=Object.freeze({});handles.set(token,{batch,artifact,authorization});return token;},
  readArtifact(token:object):Buffer{current();const record=handles.get(token);if(!record)throw Error('artifact_identity');const {batch,artifact,authorization}=record;load(batch.resourceId);synchronous(access.assertRead(batch,authorization));const dir=safeDirectory(batch),fd=openSync(join(dir,artifact.index+'.blob'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size!==artifact.size)throw Error('artifact_changed');const data=readFileSync(fd);if(data.length!==artifact.size||sha(data)!==artifact.sha256)throw Error('artifact_changed');synchronous(access.assertRead(batch,authorization));current();return data;}finally{closeSync(fd);}},
  deleteBatch(resourceId:string,context:{requestSource:Source;authorization:object}):void{
   budget.assertExternalOperationBoundary();
   const {requestSource,authorization}=context;if(requestSource!=='user')throw Error('artifact_delete_source');const batch=load(resourceId,['prepared','ready','deleted']);synchronous(access.assertDelete(batch,authorization,requestSource));budget.assertExternalOperationBoundary();const dir=directory(resourceId);
   if(existsSync(dir)){safeDirectory(batch);const allowed=new Set(batch.artifacts.map(x=>x.index+'.blob'));for(const name of readdirSync(dir)){if(!allowed.has(name))throw Error('artifact_delete_unknown_file');const path=join(dir,name),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('artifact_delete_unknown_file');unlinkSync(path);}rmdirSync(dir);}
   // A prior attempt may have removed the directory but failed this barrier.
   // Absence alone must not refund bytes whose deletion was never durable.
   syncDirectoryTreeStrict(root);
   runVerificationTransaction(db,()=>{db.prepare("UPDATE verification_artifact_batches SET state='deleted' WHERE resource_id=?").run(resourceId);});
   const proof=Object.freeze({});deleted.set(proof,batch.reservation);if(budget.getState(batch.reservation)==='released')return;const reserved=budget.reserve(batch.reservation);budget.release(reserved.token,proof);
  },
  close(){closed=true;},
 });
}
