import {createKnownDirectoryWriterFence} from '../../../runtime/verification/known-directory-writer-fence.js';
import { assertOrdinarySourceWriterRoute, observeOrdinaryDirectoryWriter } from '../../../runtime/verification/ordinary-source-writer-observation.js';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,existsSync,realpathSync,mkdirSync,unlinkSync,opendirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {writeFileAtomicallySync,syncDirectoryTreeStrict} from '../../../utils/atomic-file.js';
export const SESSION_ALIAS_RESERVED_BYTES=1024*1024;
const INDEX_LIMIT=128*1024,MARKER_LIMIT=2048,ROWS_LIMIT=256;
export interface SessionAliasBinding {aliasId:string;holderRoot:string;holderId:string;targetSessionId:string;domainInitializationId:string;domainGeneration:number}
export interface SessionAliasRow extends SessionAliasBinding {state:'active'|'release_pending'|'released'}
const keys=['aliasId','holderRoot','holderId','targetSessionId','domainInitializationId','domainGeneration'];
function fail(reason:string):never{throw Error(`session_alias_${reason}`);}
function exact(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||names.some(key=>!Object.hasOwn(value,key)))fail('schema');}
export function captureSessionAlias(value:SessionAliasBinding):SessionAliasBinding {
 const next=Object.fromEntries(keys.map(key=>[key,value[key as keyof SessionAliasBinding]]));
 for(const key of ['aliasId','targetSessionId','domainInitializationId'])if(typeof next[key]!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(next[key] as string))fail('identity');
 if(typeof next.holderId!=='string'||!next.holderId||Buffer.byteLength(next.holderId)>512||next.holderId.includes('\0'))fail('identity');
 if(typeof next.holderRoot!=='string'||!isAbsolute(next.holderRoot)||resolve(next.holderRoot)!==next.holderRoot||Buffer.byteLength(next.holderRoot)>1024||next.holderRoot.includes('\0'))fail('root');
 if(!Number.isSafeInteger(next.domainGeneration)||Number(next.domainGeneration)<1)fail('generation');
 return next as unknown as SessionAliasBinding;
}
function read(path:string,limit:number):unknown {
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>limit)fail('file_limit');const buffer=Buffer.alloc(limit+1);let n=0;
  while(n<buffer.length){const count=readSync(fd,buffer,n,buffer.length-n,null);if(!count)break;n+=count;}
  if(n>limit)fail('file_limit');return JSON.parse(buffer.subarray(0,n).toString('utf8'));
 }finally{closeSync(fd);}
}
const index=(root:string)=>join(root,'.session-aliases.json');
const enabled=(root:string)=>join(root,'.session-aliases-enabled');
export function readSessionAliases(root:string):SessionAliasRow[]{
 if(!existsSync(index(root))){if(existsSync(enabled(root)))fail('inventory_missing');return [];}
 if(!existsSync(enabled(root)))fail('inventory_unregistered');
 if(read(enabled(root),64)!==1)fail('inventory_marker');
 return parseSessionAliasRows(read(index(root),INDEX_LIMIT));
}
/** Original index schema, shared with captured bytes without filesystem reads. */
export function parseSessionAliasRows(value:unknown):SessionAliasRow[]{
 exact(value,['version','rows']);
 if(value.version!==1||!Array.isArray(value.rows)||value.rows.length>ROWS_LIMIT)fail('schema');
 const ids=new Set<string>(),holders=new Set<string>();
 return value.rows.map((row:unknown)=>{exact(row,[...keys,'state']);const binding=captureSessionAlias(row as unknown as SessionAliasBinding);
  if(!['active','release_pending','released'].includes(String(row.state))||ids.has(binding.aliasId))fail('schema');ids.add(binding.aliasId);
  const holder=JSON.stringify([binding.holderRoot,binding.holderId]);if(holders.has(holder))fail('duplicate_holder');holders.add(holder);
  return {...binding,state:row.state as SessionAliasRow['state']};});
}
export function reserveSessionAliasBytes(root:string,requested=false):number {
 if(!existsSync(index(root))&&!existsSync(enabled(root))){assertAliasFileBudget(root,[]);return requested?SESSION_ALIAS_RESERVED_BYTES:0;}
 const rows=readSessionAliases(root);assertAliasFileBudget(root,rows);return SESSION_ALIAS_RESERVED_BYTES;
}
function assertAliasFileBudget(root:string,rows:SessionAliasRow[]){
 const known=new Map<string,Set<string>>();
 for(const row of rows){const directory=join(row.holderRoot,'.canonical-session-aliases');let names=known.get(directory);if(!names)known.set(directory,names=new Set());names.add(createHash('sha256').update(row.holderId).digest('hex')+'.json');}
 let bytes=0,files=0;
 for(const [directory,names] of known){
  if(!existsSync(directory))continue;const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('holder_changed');
  const entries=opendirSync(directory);
  try{for(let entry=entries.readSync();entry;entry=entries.readSync()){
   if(++files>ROWS_LIMIT||!names.has(entry.name))fail('unknown_marker');
   const file=lstatSync(join(directory,entry.name));if(!file.isFile()||file.isSymbolicLink()||file.size>MARKER_LIMIT)fail('marker_limit');bytes+=file.size;
  }}finally{entries.closeSync();}
 }
 if(existsSync(root)){const entries=opendirSync(root);let count=0;try{for(let entry=entries.readSync();entry;entry=entries.readSync()){if(++count>4096)fail('root_entry_limit');if(entry.name.startsWith('..session-aliases')&&entry.name.endsWith('.tmp'))fail('orphan_temporary');}}finally{entries.closeSync();}}
 // Reserve two complete index images, the maximum remaining marker population,
 // one in-flight marker and the sentinel; never only count currently written rows.
 if(bytes+(ROWS_LIMIT-files)*MARKER_LIMIT+2*INDEX_LIMIT+MARKER_LIMIT+64>SESSION_ALIAS_RESERVED_BYTES)fail('quota');
}
function write(root:string,rows:SessionAliasRow[]){
 assertAliasFileBudget(root,rows);
 const bytes=JSON.stringify({version:1,rows});if(rows.length>ROWS_LIMIT||Buffer.byteLength(bytes)>INDEX_LIMIT)fail('quota');
 // Sticky sentinel is durable before any entry. Missing index after this point
 // is uncertainty, never a new empty inventory.
 if(!existsSync(enabled(root)))writeFileAtomicallySync(enabled(root),'1',{requireDirectorySync:true});
 writeFileAtomicallySync(index(root),bytes,{requireDirectorySync:true});
}
function marker(root:string,binding:SessionAliasBinding){return {version:1,canonicalRoot:resolve(root),binding};}
function markerPath(binding:SessionAliasBinding){return join(binding.holderRoot,'.canonical-session-aliases',createHash('sha256').update(binding.holderId).digest('hex')+'.json');}
function verifyHolder(binding:SessionAliasBinding){const stat=lstatSync(binding.holderRoot);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(binding.holderRoot)!==binding.holderRoot)fail('holder_changed');
 const directory=join(binding.holderRoot,'.canonical-session-aliases');if(existsSync(directory)){const dir=lstatSync(directory);if(!dir.isDirectory()||dir.isSymbolicLink())fail('holder_changed');}}
/** Caller holds the shared FileSessionStore root mutation lock and actual target
 * execution lease. This low-level identity transaction does not issue grants. */
function assertAliasWriterOpen(root:string,binding:SessionAliasBinding){
 createKnownDirectoryWriterFence(root,'session-root').assertOpen();
 createKnownDirectoryWriterFence(join(binding.holderRoot,'.canonical-session-aliases'),'session-alias-holder').assertOpen();
}
export function registerSessionAliasLocked(root:string,input:SessionAliasBinding){
 const binding=captureSessionAlias(input);assertAliasWriterOpen(root,binding);const rows=readSessionAliases(root),existing=rows.find(row=>row.aliasId===binding.aliasId);
 if(existing){if(!isDeepStrictEqual(captureSessionAlias(existing),binding))fail('conflict');if(existing.state!=='active')fail('released');}
 else if(rows.some(row=>row.holderRoot===binding.holderRoot&&row.holderId===binding.holderId))fail('holder_conflict');
 verifyHolder(binding);const path=markerPath(binding),bytes=JSON.stringify(marker(root,binding));if(Buffer.byteLength(bytes)>MARKER_LIMIT)fail('marker_limit');
 if(existsSync(path)&&!isDeepStrictEqual(read(path,MARKER_LIMIT),marker(root,binding)))fail('marker_conflict');
 assertOrdinarySourceWriterRoute();
 const directory=join(binding.holderRoot,'.canonical-session-aliases');
 mkdirSync(directory,{recursive:true,mode:0o700});
 observeOrdinaryDirectoryWriter(directory,'session-alias-holder');
 assertOrdinarySourceWriterRoute();
 write(root,existing?rows:[...rows,{...binding,state:'active'}]);
 writeFileAtomicallySync(path,bytes,{requireDirectorySync:true});return Object.freeze({markerPath:path,binding:Object.freeze(binding)});
}
export function releaseSessionAliasLocked(root:string,input:SessionAliasBinding){
 const binding=captureSessionAlias(input);assertAliasWriterOpen(root,binding);const rows=readSessionAliases(root),existing=rows.find(row=>row.aliasId===binding.aliasId);
 if(!existing||!isDeepStrictEqual(captureSessionAlias(existing),binding))fail('conflict');
 verifyHolder(binding);
 const existingDirectory=join(binding.holderRoot,'.canonical-session-aliases');
 if(existsSync(existingDirectory))observeOrdinaryDirectoryWriter(existingDirectory,'session-alias-holder');
 assertOrdinarySourceWriterRoute();
 if(existing.state==='released'){write(root,rows);return;}
 verifyHolder(binding);const path=markerPath(binding);
 if(existing.state==='active'){
  // A missing marker does not authorize release by itself. This method is only
  // entered for an explicit host user request, made durable before unlink.
  if(existsSync(path)&&!isDeepStrictEqual(read(path,MARKER_LIMIT),marker(root,binding)))fail('marker_conflict');
  existing.state='release_pending';write(root,rows);
 }
 if(existsSync(path)){if(!isDeepStrictEqual(read(path,MARKER_LIMIT),marker(root,binding)))fail('marker_conflict');unlinkSync(path);}
 const markerDirectory=join(binding.holderRoot,'.canonical-session-aliases');
 syncDirectoryTreeStrict(existsSync(markerDirectory)?markerDirectory:binding.holderRoot);
 existing.state='released';write(root,rows);
}
export function assertNoSessionAliases(root:string,sessionId:string){
 const references=readSessionAliases(root).filter(row=>row.targetSessionId===sessionId&&row.state!=='released');
 if(references.length)throw Object.assign(Error('session_referenced_by_canonical_alias'),{aliases:structuredClone(references)});
}
/** Read-only route. Missing/retired/uncertain marker never falls back to an old
 * holder snapshot and never produces an execution lease or writable store. */
export function readSessionAliasBinding(root:string,input:{holderRoot:string;holderId:string}):SessionAliasBinding|null {
 const rows=readSessionAliases(root),row=rows.find(item=>item.holderRoot===input.holderRoot&&item.holderId===input.holderId);
 if(!row){
  // Ordinary task IDs and relative host roots retain their old contract. A
  // missing alias does not impose the stricter registration schema on them.
  const path=join(input.holderRoot,'.canonical-session-aliases',createHash('sha256').update(input.holderId).digest('hex')+'.json');
  if(existsSync(path))fail('unregistered_marker');return null;
 }
 if(row.state!=='active')fail('route_unavailable');
 const binding=captureSessionAlias(row);verifyHolder(binding);
 if(!existsSync(markerPath(binding))||!isDeepStrictEqual(read(markerPath(binding),MARKER_LIMIT),marker(root,binding)))fail('route_unavailable');
 return Object.freeze(binding);
}
