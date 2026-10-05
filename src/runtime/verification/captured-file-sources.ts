import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {basename,dirname,isAbsolute,join,resolve,relative,sep} from 'node:path';
import {readCapturedFileSession,parseFileSessionSnapshot,parseSessionDeletionJournal} from '../../ai/runtime/session-store/file-store.js';
import {captureSessionAlias,parseSessionAliasRows,type SessionAliasBinding,type SessionAliasRow} from '../../ai/runtime/session-store/aliases.js';
import {captureMigrationMarker,computeSessionSnapshotHash} from '../../ai/runtime/session-store/migration.js';
import {readCapturedGoalSessions} from '../goal/file-store.js';
import {parseGoalNativeJournalDocument} from '../goal/native-mutation-journal.js';
import {readCapturedTaskDeclarations} from '../task-host/snapshot-store.js';
import {desktopObservationSessionId} from '../task-host/protected-observation-store.js';
import {parseOrdinaryProfileSources} from './ordinary-profile-source-registry.js';
import {capturedFields,capturedIdentity,freezeCapturedData,parseCapturedSourceJson} from './captured-source-json.js';
import {readProfileSourceCapture,readProfileDirectoryEntries,readProfileDirectoryFile,readProfileSqliteSchema} from './profile-source-capture.js';

type Source=ReturnType<typeof readProfileSourceCapture>['sources'][number];
type TaskDeclaration=ReturnType<typeof readCapturedTaskDeclarations>;
type SessionDeclaration=ReturnType<typeof readCapturedFileSession>;
type Marker={sourceId:string;path:string;canonicalRoot:string;binding:SessionAliasBinding};
type FileSourceFacts={sourceId:string;snapshotHash:string;kind:Source['source']['kind'];directory:string;
 entries:ReturnType<typeof readProfileDirectoryEntries>;
 sessions:SessionDeclaration[];migrations:ReturnType<typeof captureMigrationMarker>[];
 deletions:ReturnType<typeof parseSessionDeletionJournal>[];tasks:TaskDeclaration[];
 goals:ReturnType<typeof readCapturedGoalSessions>[];
 nativeGoals:Array<{sessionId:string;records:ReturnType<typeof parseGoalNativeJournalDocument>}>;
 aliases:SessionAliasRow[];activeTaskIds:string[];lastSessionReference:string|null;
 registry:ReturnType<typeof parseOrdinaryProfileSources>|null;
 sourceReferences:Array<{path:string;sourceId:string;sessionIdentities:string[];unresolved:boolean}>};
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail(reason:string):never{throw Error('captured_file_'+reason);}
function fileIdentity(value:string){if(!/^[A-Za-z0-9_-]{1,160}$/.test(value))fail('identity');return value;}
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('document');return raw as Record<string,unknown>;}

/** Complete file-source statements from an existing all-source capture. This
 * synchronous reader performs no source IO, repair, native enrollment or grant. */
export function readCapturedFileSources(owner:object,token:object){
 const capture=readProfileSourceCapture(owner,token),sources:FileSourceFacts[]=[],markers:Marker[]=[];
 const sessionBodies=new Map<string,Map<string,string>>();
 for(const {source,snapshotHash} of capture.sources){
  if(source.kind==='sqlite-db')continue;
  const entries=readProfileDirectoryEntries(owner,token,source.sourceId),files=new Map<string,string>(),fileBytes=new Map<string,number>();
  const facts:FileSourceFacts={sourceId:source.sourceId,snapshotHash,kind:source.kind,directory:source.directory.canonicalPath,entries,sessions:[],migrations:[],deletions:[],tasks:[],goals:[],nativeGoals:[],aliases:[],activeTaskIds:[],lastSessionReference:null,registry:null,sourceReferences:[]};
  const body=(index:number,limit?:number)=>{
   const bytes=readProfileDirectoryFile(owner,token,source.sourceId,index);if(limit!==undefined&&bytes.length>limit)fail('size');
   const path=entries[index]!.path;
   // Only these original readers use TextDecoder's BOM removal. The ordinary
   // JSON readers retain U+FEFF, so capture must not silently repair their data.
   const stripsBom=source.kind==='profile-registry'&&path==='registry.json'||source.kind==='goal-file-root'&&/^[a-f0-9]{64}\.native-goal\.json$/.test(path);
   return new TextDecoder('utf8',{fatal:true,ignoreBOM:!stripsBom}).decode(bytes);
  };
  for(const [index,entry] of entries.entries()){
   if(entry.kind==='file'){if(files.has(entry.path))fail('duplicate');files.set(entry.path,body(index));fileBytes.set(entry.path,entry.byteLength);continue;}
   if(entry.kind==='directory'){
    const allowed=source.kind==='session-root'?['.migrations','.deletions','.session-execution']:source.kind==='task-root'?['snapshots']:[];
    const absolute=join(source.directory.canonicalPath,...entry.path.split('/'));
    const leadsToDeclaredSource=capture.sources.some(({source:target})=>{if(target.kind==='sqlite-db')return false;const child=relative(absolute,target.directory.canonicalPath);return !!child&&child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child);});
    if(!allowed.includes(entry.path)&&!leadsToDeclaredSource)fail('namespace');continue;
   }
   const absolute=join(source.directory.canonicalPath,...entry.path.split('/'));
   let target:Source['source']|undefined;
   if((entry.mode&0o170000)===0o040000){
    target=capture.sources.map(s=>s.source).find(s=>s.kind!=='sqlite-db'&&s.directory.canonicalPath===absolute&&s.directory.device===entry.device&&s.directory.inode===entry.inode);
   }else{
    const cleanup=source.kind==='session-root'?/^(?:\.session-store-lock|[A-Za-z0-9_-]{1,160}\.json\.save-lock)\.cleanup\.sqlite(?:-wal|-shm|-journal)?$/:source.kind==='goal-file-root'?/^\.goal-(?:store|native)\.save\.lock\.cleanup\.sqlite(?:-wal|-shm|-journal)?$/:source.kind==='task-root'?/^\.task-store\.save\.lock\.cleanup\.sqlite(?:-wal|-shm|-journal)?$/:/^\.profile-source-registry\.lock\.cleanup\.sqlite(?:-wal|-shm|-journal)?$/;
    const execution=source.kind==='session-root'&&/^\.session-execution\/[a-f0-9]{64}\.sqlite(?:-wal|-shm|-journal)?$/.test(entry.path);
    const goals=source.kind==='goal-file-root'&&/^goals\.sqlite(?:-wal|-shm|-journal)?$/.test(entry.path);
    if(!execution&&!goals&&!cleanup.test(entry.path))fail('namespace');
    target=capture.sources.map(s=>s.source).find(s=>s.kind==='sqlite-db'&&s.snapshotFormat===(goals?'goal-sqlite-v1':'writer-lock-sqlite-v1')&&['','-wal','-shm','-journal'].some(suffix=>join(s.directory.canonicalPath,s.database.basename+suffix)===absolute));
    if(target?.kind==='sqlite-db'&&target.snapshotFormat==='writer-lock-sqlite-v1'&&readProfileSqliteSchema(owner,token,target.sourceId).length)fail('writer_lock_schema');
   }
   if(!target)fail('reference');
   // The complete capture already checked the actual file/sidecar identity;
   // this additional check binds its original semantic format and namespace.
   facts.sourceReferences.push({path:entry.path,sourceId:target.sourceId,sessionIdentities:[],unresolved:false});
  }
  const take=(path:string,limit?:number)=>{const raw=files.get(path);if(raw===undefined)fail('missing');if(limit!==undefined&&fileBytes.get(path)!>limit)fail('size');files.delete(path);fileBytes.delete(path);return raw;};
  if(source.kind==='session-root'){
   const bodies=new Map<string,string>();sessionBodies.set(source.directory.canonicalPath,bodies);
   for(const path of [...files.keys()])if(/^[A-Za-z0-9_-]{1,160}\.json$/.test(path)){
    const id=fileIdentity(path.slice(0,-5)),raw=take(path);facts.sessions.push(readCapturedFileSession(raw,id));bodies.set(id,raw);
   }
   for(const path of [...files.keys()])if(path.startsWith('.migrations/')){
    if(!/^\.migrations\/[A-Za-z0-9_-]{1,160}\.json$/.test(path))fail('namespace');
    const id=fileIdentity(basename(path).slice(0,-5)),marker=captureMigrationMarker(parseCapturedSourceJson(take(path,16384))),raw=bodies.get(id);
    if(marker.sessionId!==id||raw===undefined)fail('migration');
    const snapshot=parseFileSessionSnapshot(raw,id);
    if(marker.expectedStoreRevision!==(snapshot.storeRevision??0)||marker.expectedSnapshotHash!==computeSessionSnapshotHash(snapshot))fail('migration');facts.migrations.push(marker);
   }
   for(const path of [...files.keys()])if(path.startsWith('.deletions/')){
    if(!/^\.deletions\/[A-Za-z0-9_-]{1,160}\.json$/.test(path))fail('namespace');
    const id=fileIdentity(basename(path).slice(0,-5)),deletion=parseSessionDeletionJournal(parseCapturedSourceJson(take(path,8*1024**2)),id),raw=bodies.get(id);
    if(raw!==undefined&&(deletion.state==='committed'||hash(raw)!==deletion.snapshotHash))fail('deletion');
    if(facts.migrations.some(m=>m.sessionId===id))fail('deletion');facts.deletions.push(deletion);
   }
   if(files.has('.session-aliases.json')!==files.has('.session-aliases-enabled'))fail('alias_inventory');
   if(files.has('.session-aliases.json')){if(parseCapturedSourceJson(take('.session-aliases-enabled',64))!==1)fail('alias_inventory');facts.aliases=parseSessionAliasRows(parseCapturedSourceJson(take('.session-aliases.json',128*1024)));}
   if(files.has('last_session')){const id=take('last_session').trim();if(id){fileIdentity(id);facts.lastSessionReference=id;}}
   const identities=[...new Set([...bodies.keys(),...facts.deletions.map(d=>d.sessionId),...facts.migrations.map(m=>m.sessionId),...facts.aliases.map(a=>a.targetSessionId)])];
   for(const reference of facts.sourceReferences){
    const match=/^\.session-execution\/([a-f0-9]{64})\.sqlite/.exec(reference.path);
    if(match){reference.sessionIdentities=identities.filter(id=>hash(id.toLowerCase())===match[1]);reference.unresolved=reference.sessionIdentities.length===0;}
   }
  }else if(source.kind==='session-alias-holder'){
   if(basename(source.directory.canonicalPath)!=='.canonical-session-aliases')fail('alias_holder');
   for(const path of [...files.keys()]){
    if(!/^[a-f0-9]{64}\.json$/.test(path))fail('namespace');
    const value=record(parseCapturedSourceJson(take(path,2048)));capturedFields(value,['version','canonicalRoot','binding']);capturedFields(value.binding,['aliasId','holderRoot','holderId','targetSessionId','domainInitializationId','domainGeneration']);
    const binding=captureSessionAlias(value.binding as SessionAliasBinding);
    if(value.version!==1||typeof value.canonicalRoot!=='string'||!isAbsolute(value.canonicalRoot)||resolve(value.canonicalRoot)!==value.canonicalRoot||value.canonicalRoot.includes('\0')||binding.holderRoot!==dirname(source.directory.canonicalPath)||hash(binding.holderId)+'.json'!==path)fail('alias_marker');
    markers.push({sourceId:source.sourceId,path,canonicalRoot:value.canonicalRoot,binding});
   }
  }else if(source.kind==='goal-file-root'){
   for(const path of [...files.keys()]){
    if(/^[a-f0-9]{64}\.native-goal\.json$/.test(path)){
     const value=record(parseCapturedSourceJson(take(path,2*1024**2)));capturedIdentity(value.sessionId);
     if(hash(value.sessionId)+'.native-goal.json'!==path)fail('goal_native_identity');
     facts.nativeGoals.push({sessionId:value.sessionId,records:parseGoalNativeJournalDocument(value,value.sessionId)});
    }else if(path.endsWith('.goal.json')&&!path.includes('/')){const id=path.slice(0,-10);capturedIdentity(id);facts.goals.push(readCapturedGoalSessions(take(path),id));}
    else fail('namespace');
   }
  }else if(source.kind==='task-root'){
   for(const path of [...files.keys()])if(path.startsWith('snapshots/')&&path.endsWith('.json')&&!path.endsWith('.journal.jsonl')){
    const id=path.slice('snapshots/'.length,-5);capturedIdentity(id);if(id.includes('/'))fail('namespace');
    const journal=`snapshots/${id}.journal.jsonl`;
    facts.tasks.push(readCapturedTaskDeclarations(take(path),files.has(journal)?take(journal):'',id));
   }
   if(files.has('active-task.json')){
    const value=record(parseCapturedSourceJson(take('active-task.json')));
    if(Object.hasOwn(value,'activeTaskIds')){capturedFields(value,['activeTaskIds']);if(!Array.isArray(value.activeTaskIds))fail('active_tasks');facts.activeTaskIds=value.activeTaskIds.map(id=>{capturedIdentity(id);return id;});}
    else{capturedFields(value,['activeTaskId']);if(value.activeTaskId!==null){capturedIdentity(value.activeTaskId);facts.activeTaskIds=[value.activeTaskId];}}
    if(new Set(facts.activeTaskIds).size!==facts.activeTaskIds.length||facts.activeTaskIds.some(id=>!facts.tasks.some(t=>t.taskId===id)))fail('active_tasks');
   }
  }else if(source.kind==='profile-registry'){
   facts.registry=parseOrdinaryProfileSources(parseCapturedSourceJson(take('registry.json',512*1024)),capture.uid);
   for(const registered of facts.registry.sources){
    const actual=capture.sources.find(s=>s.source.sourceId===registered.sourceId)?.source;
    if(!actual||actual.kind!==registered.kind||actual.snapshotFormat!==registered.snapshotFormat||!isDeepStrictEqual(actual.directory,registered.directory)||!isDeepStrictEqual(actual.kind==='sqlite-db'?actual.database:undefined,registered.database))fail('registry_reference');
   }
  }else fail('kind');
  if(files.size)fail('namespace');sources.push(facts);
 }
 const aliases:Array<{canonicalSourceId:string;state:SessionAliasRow['state'];binding:SessionAliasBinding;marker:{sourceId:string;path:string}|null;target:'present'|'missing';unresolvedReasons:string[]}>=[],matchedMarkers=new Set<Marker>();
 for(const source of sources)for(const row of source.aliases){
  const binding=captureSessionAlias(row),path=join(binding.holderRoot,'.canonical-session-aliases',hash(binding.holderId)+'.json');
  // An absent marker is meaningful only inside its actually held directory.
  // Pending/released rows must not turn an omitted source into proof of absence.
  if(!sources.some(s=>s.kind==='session-alias-holder'&&s.directory===dirname(path)))fail('alias_holder_source');
  const marker=markers.find(m=>join(m.binding.holderRoot,'.canonical-session-aliases',m.path)===path);
  const matches=marker?.canonicalRoot===source.directory&&isDeepStrictEqual(marker.binding,binding);
  const present=sessionBodies.get(source.directory)?.has(binding.targetSessionId)??false;
  if(row.state==='released'){if(matches)fail('alias_released');}
  else{
   if(!present||row.state==='active'&&(parseFileSessionSnapshot(sessionBodies.get(source.directory)!.get(binding.targetSessionId)!,binding.targetSessionId).executionProtected!==true||source.migrations.some(m=>m.sessionId===binding.targetSessionId)||source.deletions.some(d=>d.sessionId===binding.targetSessionId)))fail('alias_target');
   if(row.state==='active'&&!matches||marker&&!matches)fail('alias_marker');
   if(matches){if(matchedMarkers.has(marker!))fail('alias_duplicate');matchedMarkers.add(marker!);}
  }
  aliases.push({canonicalSourceId:source.sourceId,state:row.state,binding,marker:matches?{sourceId:marker!.sourceId,path:marker!.path}:null,target:present?'present':'missing',unresolvedReasons:[...(row.state==='release_pending'?['release-pending']:[]),...(!present?['historical-target-missing']:[])]});
 }
 if(markers.some(marker=>!matchedMarkers.has(marker)))fail('alias_orphan');
 const observationSides=sources.filter(s=>s.kind==='task-root').flatMap(taskRoot=>{
  const sidecar=sources.find(s=>s.kind==='session-root'&&s.directory===join(taskRoot.directory,'protected-observation-sessions'));
  const identities=new Set([...(sidecar?.sessions.map(s=>s.containerSessionId)??[]),...(sidecar?.deletions.map(s=>s.sessionId)??[]),...(sidecar?.migrations.map(s=>s.sessionId)??[]),...taskRoot.tasks.map(t=>desktopObservationSessionId(t.taskId))]);
  return [...identities].map(sessionIdentity=>{
   const taskIds=taskRoot.tasks.filter(t=>desktopObservationSessionId(t.taskId)===sessionIdentity).map(t=>t.taskId);
   const present=sidecar?.sessions.some(s=>s.containerSessionId===sessionIdentity)??false,deletion=sidecar?.deletions.find(d=>d.sessionId===sessionIdentity);
   return {taskSourceId:taskRoot.sourceId,sessionSourceId:sidecar?.sourceId??null,sessionIdentity,taskIds,
    state:deletion?`deletion-${deletion.state}`:present?'body':'missing',
    missingReasons:[...(!sidecar?['sidecar-source-absent']:[]),...(!present?['body-absent']:[]),...(!taskIds.length?['historical-task-missing']:[])]};
  });
 });
 const historicalPointers=sources.filter(s=>s.lastSessionReference!==null).map(s=>({sourceId:s.sourceId,sessionIdentity:s.lastSessionReference!,present:s.sessions.some(row=>row.containerSessionId===s.lastSessionReference)}));
 readProfileSourceCapture(owner,token);
 return freezeCapturedData({kind:'captured-file-source-declarations' as const,sources,aliases,observationSides,historicalPointers});
}
