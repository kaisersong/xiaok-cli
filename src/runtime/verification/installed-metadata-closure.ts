import {parseIntentHostSubject,intentHostSubjectOwner} from './intent-host-subject.js';
import {parseIntentContractEnrollment,intentContractOriginalRegistration} from './intent-contract-enrollment.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {parseLoopHostSubject,loopHostSubjectOwner} from './loop-host-subject.js';
import {parseOwnerEnrollmentRegistration} from './owner-enrollment-review.js';
import {isDeepStrictEqual as initialIsDeepStrictEqual} from 'node:util';
const isDeepStrictEqual=initialIsDeepStrictEqual;
import type {InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {readInstalledMetadataSessionFacts} from './installed-metadata-source.js';
import {readInstalledProfileSourceCapture,checkInstalledProfileSourceCapture} from './profile-source-capture.js';
import {iterateCapturedProfileDeclarations,type CapturedProfileEvent} from './captured-profile-mapper.js';
import {decodeCapturedLoopRow} from './captured-sqlite-loop-values.js';
import type {CapturedSqliteCell} from './source-sqlite-cell.js';
import {capturedGoalTaskKey} from './captured-goal-task-key.js';
import {freezeCapturedData} from './captured-source-json.js';
import {profileRecord,type CapturedProfileOrigin} from './captured-profile-relations.js';

type NativeFacts=ReturnType<typeof readInstalledMetadataSessionFacts>;
type CaptureFacts=ReturnType<typeof readInstalledProfileSourceCapture>;
type Family=Extract<CapturedProfileEvent,{kind:'family-fact'}>['family'];
type Complete=Extract<CapturedProfileEvent,{kind:'complete'}>;
type Row=Readonly<Record<string,unknown>>;
interface Session {sourceId:string;family:Family;recordKind:'session';originalRecordKey:string;sessionId:string;origin:CapturedProfileOrigin}
interface Unresolved {reason:string;origin:CapturedProfileOrigin;detail?:unknown}
interface Dependency {namespace:string;id:string;origin:CapturedProfileOrigin;scope?:unknown}
interface Entity {
 sourceId:string;family:Family;recordKind:'session'|'task'|'goal'|'loop'|'loop_run'|'loop_stage'|'loop-embedded-task'|'codex-session'|'codex-thread'|'codex-route'|'group'|'group-agent'|'groups-row'|'artifact-workspace'|'artifact-lineage'|'artifact-version'|'artifact-row'|'intent'|'intent-stage'|'intent-native-contract'|'loop-row'|'kswarm-row';originalRecordKey:string;
 origin:CapturedProfileOrigin;original:unknown;dependencies:Dependency[];sessions:Session[];unresolved:Unresolved[];
}
interface Node {entity:Entity;direct:Session[];targets:Node[];pending:Dependency[]}
const list=(v:unknown):readonly unknown[]=>{if(!Array.isArray(v))throw Error('installed_metadata_closure_shape');return v;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v)throw Error('installed_metadata_closure_identity');return v;};
const at=(sourceId:string,path:string):CapturedProfileOrigin=>({sourceId,path});
const sessionKey=(v:Session)=>JSON.stringify([v.sourceId,v.family,v.recordKind,v.originalRecordKey]);
function union(sessions:readonly Session[]):Session[]{const unique=new Map(sessions.map(s=>[sessionKey(s),s]));return [...unique.values()].sort((a,b)=>Buffer.compare(Buffer.from(sessionKey(a)),Buffer.from(sessionKey(b))));}

/** Fixed first-group join. Full original events and every unresolved semantic
 * remain in the result; this is never complete legacy or write authority. */
function joinFacts(capture:CaptureFacts,native:NativeFacts,events:readonly CapturedProfileEvent[],complete:Complete){
 const nodes:Node[]=[],index=new Map<string,Node[]>(),unresolved:Unresolved[]=events.filter((e):e is Extract<CapturedProfileEvent,{kind:'gap'}>=>e.kind==='gap').map(e=>({reason:e.reason,origin:e.origin,...e.detail===undefined?{}:{detail:e.detail}}));
 const indexKey=(kind:string,id:string)=>JSON.stringify([kind,id]);
 const taskScopes=new Map<string,Node[]>(),bindings:Array<{sourceId:string;goalId:string;binding:Row;path:string}>=[];
 const files:Row[]=[],sourceRows=new Map<string,{sourceId:string;snapshotHash:string;family:Family;sessions:Session[]}>();
 for(const source of complete.sources)sourceRows.set(source.sourceId,{...source,sessions:[]});
 function gap(reason:string,origin:CapturedProfileOrigin,detail?:unknown,node?:Node){const value={reason,origin,...detail===undefined?{}:{detail}};unresolved.push(value);node?.entity.unresolved.push(value);}
 function add(sourceId:string,family:Family,kind:Entity['recordKind'],id:string,path:string,original:unknown){
  const entity:Entity={sourceId,family,recordKind:kind,originalRecordKey:id,origin:at(sourceId,path),original,dependencies:[],sessions:[],unresolved:[]};
  const node:Node={entity,direct:[],targets:[],pending:[]},key=indexKey(kind,id),entries=index.get(key)??[];entries.push(node);index.set(key,entries);nodes.push(node);return node;
 }
 function dependency(node:Node,namespace:string,id:unknown,origin:CapturedProfileOrigin,scope?:unknown){if(id==null)return;const value={namespace,id:text(id),origin,...scope===undefined?{}:{scope}};node.entity.dependencies.push(value);node.pending.push(value);}

 const nativeIntentIndex=new Map<string,Node[]>(),intentSessionOwners=new Map<Node,Node>(),sourceIntentContracts=new Map<Node,Node[]>();
 function intentDeclarations(source:Node,path:string,row:Row){
  list(row.intentSubjects).forEach((value,i)=>{const subject=parseIntentHostSubject(value),key=json(subject),kind=subject.stageId===null?'intent':'intent-stage',node=add(source.entity.sourceId,source.entity.family,kind,key,path+`.intentSubjects[${i}]`,{subject:value,sessionOrigin:source.entity.origin});
   // Attribution is this exact original physical body, not its lineage/fork graph.
   node.direct.push(...source.direct);intentSessionOwners.set(node,source);nativeIntentIndex.set(key,[...nativeIntentIndex.get(key)??[],node]);
  });
  const publication=profileRecord(row.publicationDeclarations);list(publication.nativeContracts).forEach((value,i)=>{const record=profileRecord(value),node=add(source.entity.sourceId,source.entity.family,'intent-native-contract',json([source.entity.originalRecordKey,text(record.id)]),path+`.publicationDeclarations.nativeContracts[${i}]`,{record:value,sessionOrigin:source.entity.origin});node.direct.push(...source.direct);sourceIntentContracts.set(source,[...sourceIntentContracts.get(source)??[],node]);});
 }

 const scopedSessionReferences:Array<{node:Node;root:string;id:string;origin:CapturedProfileOrigin;reference:Row}>=[];
 function session(sourceId:string,family:Family,path:string,value:unknown){
  const row=profileRecord(value),id=text(row.containerSessionId),node=add(sourceId,family,'session',id,path,row);
  if(row.storedSessionIdentity==='present')node.direct.push({sourceId,family,recordKind:'session',originalRecordKey:id,sessionId:id,origin:at(sourceId,path+'.containerSessionId')});
  else gap('stored-session-identity-'+String(row.storedSessionIdentity),at(sourceId,path+'.storedSessionIdentity'),row.storedSessionIdentity,node);
  list(row.lineageReferences).forEach((id,i)=>dependency(node,'session',id,at(sourceId,path+`.lineageReferences[${i}]`)));
  dependency(node,'session',row.forkReference,at(sourceId,path+'.forkReference'));

  list(row.sessionReferences).forEach((value,i)=>{const reference=profileRecord(value),id=text(reference.sessionIdentity),origin=at(sourceId,path+`.sessionReferences[${i}]`);
   if(reference.childStoreRoot===undefined)dependency(node,'session',id,origin,reference);
   else{node.entity.dependencies.push({namespace:'session',id,origin,scope:reference});scopedSessionReferences.push({node,root:text(reference.childStoreRoot),id,origin,reference});}
  });
  list(row.typedReferences).forEach((value,i)=>{const reference=profileRecord(value),origin=at(sourceId,path+`.typedReferences[${i}]`);node.entity.dependencies.push({namespace:text(reference.namespace),id:text(reference.identity),origin,scope:reference});gap('unsupported-session-reference',origin,reference,node);});

  intentDeclarations(node,path,row);
 }
 function task(sourceId:string,path:string,value:unknown,family:Family='file',kind:'task'|'loop-embedded-task'='task',recordKey?:string){
  const row=profileRecord(value),node=add(sourceId,family,kind,recordKey??text(row.taskId),path,row);
  list(row.sessionIdentities).forEach((id,i)=>dependency(node,'session',id,at(sourceId,path+`.sessionIdentities[${i}]`)));
  list(row.references).forEach(value=>{
   const reference=profileRecord(value);
   if(['task','goal'].includes(String(reference.namespace))){
    // Parent execution attachments and context declarations are references,
    // not a reverse ownership edge into every other task of that parent.
    node.entity.dependencies.push({namespace:text(reference.namespace),id:text(reference.id),origin:at(sourceId,path+'.'+text(reference.relation)),scope:{...reference,resolution:'declaration-only'}});
   }
  });
  if(kind==='task')list(row.executionScopeDeclarations).forEach(value=>{const declaration=profileRecord(value),scope=profileRecord(declaration.scope);if(scope.kind!=='goal_turn')return;const key=capturedGoalTaskKey(row.taskId,scope),entries=taskScopes.get(key)??[];if(!entries.includes(node))entries.push(node);taskScopes.set(key,entries);});
  return node;
 }
 function goal(sourceId:string,family:Family,path:string,value:unknown){
  const row=profileRecord(value);
  list(row.goalAssociations).forEach((value,i)=>{const association=profileRecord(value),base=path+`.goalAssociations[${i}]`,node=add(sourceId,family,'goal',text(association.goalId),base,association);
   list(association.completionTasks).forEach((value,j)=>{
    const task=profileRecord(value),origin=at(sourceId,base+`.completionTasks[${j}].taskId`);
    if(family==='goal'){
     // Retain the declaration, but only a complete original SQL binding joined
     // to the Task's exact execution scope may add the execution graph edge.
     node.entity.dependencies.push({namespace:'task',id:text(task.taskId),origin,scope:{...task,resolution:'requires-goal-task-binding'}});
    }else dependency(node,'task',task.taskId,origin,task);
   });
   list(association.evidenceOwners).forEach((value,j)=>{const evidence=profileRecord(value);dependency(node,text(evidence.ownerKind),evidence.ownerId,at(sourceId,base+`.evidenceOwners[${j}].ownerId`),evidence);});
  });
 }




 const artifactParents:Array<{node:Node;parentKind:'artifact-workspace'|'artifact-lineage';parentId:string;path:string}>=[];
 function artifactRow(fact:Row){
  if(fact.kind!=='row')return;
  const sourceId=text(fact.sourceId),table=text(fact.table),path=table+'['+text(fact.rowid)+']',cells=profileRecord(fact.record);
  const identity=(name:string)=>{const cell=profileRecord(cells[name]);if(cell.type!=='text')throw Error('installed_metadata_artifact_identity');return text(cell.value);};
  const kind=table==='artifact_workspaces'?'artifact-workspace':table==='artifact_lineages'?'artifact-lineage':table==='artifact_workspace_versions'?'artifact-version':'artifact-row',key=kind==='artifact-row'?JSON.stringify([table,text(fact.rowid)]):identity('id'),node=add(sourceId,'artifact',kind,key,path,fact);
  for(const [column,parentKind] of [['workspace_id','artifact-workspace'],['lineage_id','artifact-lineage']] as const){
   // Only the original schema's workspace children and Lineage's Versions
   // aggregate forward; arbitrary soft lineage declarations stay unresolved.
   if(column==='lineage_id'&&kind!=='artifact-version')continue;
   const cell=cells[column]===undefined?undefined:profileRecord(cells[column]);
   if(cell?.type==='text'&&typeof cell.value==='string'&&cell.value)artifactParents.push({node,parentKind,parentId:cell.value,path:path+'.record.'+column});
  }
  list(fact.references).forEach((value,i)=>{const ref=profileRecord(value),cell=profileRecord(ref.value),namespace=text(ref.domain),origin=at(sourceId,path+`.references[${i}]`);
   if(namespace==='task'&&ref.referenceState==='declared'&&cell.type==='text'&&typeof cell.value==='string'&&cell.value)dependency(node,'task',cell.value,origin,ref);
   else{node.entity.dependencies.push({namespace,id:cell.type==='text'&&typeof cell.value==='string'&&cell.value?cell.value:JSON.stringify(cell),origin,scope:{...ref,resolution:'declaration-only'}});gap('unsupported-artifact-reference',origin,ref,node);}
  });
 }
 function kswarmRow(fact:Row){
  if(fact.kind!=='row')return;
  const sourceId=text(fact.sourceId),table=text(fact.table),rowid=text(fact.rowid),path=table+'['+rowid+']',node=add(sourceId,'kswarm','kswarm-row',json([table,rowid]),path,fact);
  // Raw SQL identity declarations and JSON bodies are not broker bindings.
  // Preserve every current, historical and metadata frame without inferring
  // a Task/Session from a project, entity key or nested user-controlled field.
  list(fact.references).forEach((value,i)=>{const ref=profileRecord(value);node.entity.dependencies.push({namespace:text(ref.domain),id:json(ref.value),origin:at(sourceId,path+`.references[${i}]`),scope:{...ref,resolution:'declaration-only'}});});
  gap(table==='state_meta'?'kswarm-metadata-semantics-required':'kswarm-session-binding-required',node.entity.origin,fact,node);
 }
 const groupsParents:Array<{node:Node;groupId:string;path:string}>=[];
 function groupsRow(fact:Row){
  if(fact.kind!=='row')return;
  const sourceId=text(fact.sourceId),table=text(fact.table),path=table+'['+text(fact.rowid)+']',cells=profileRecord(fact.cells);
  const value=(name:string)=>{const cell=profileRecord(cells[name]);if(cell.type!=='text')throw Error('installed_metadata_groups_identity');return text(cell.value);};
  const kind=table==='groups'?'group':table==='agents'?'group-agent':'groups-row',key=kind==='group'?value('group_id'):kind==='group-agent'?JSON.stringify([value('group_id'),value('agent_id')]):JSON.stringify([table,text(fact.rowid)]),node=add(sourceId,'groups',kind,key,path,fact);
  if(kind!=='group'&&cells.group_id!==undefined&&profileRecord(cells.group_id).type==='text')groupsParents.push({node,groupId:value('group_id'),path:path+'.cells.group_id'});
  list(fact.references).forEach((value,i)=>{const ref=profileRecord(value),namespace=text(ref.namespace),origin=at(sourceId,path+`.references[${i}]`);
   if(namespace==='task'||namespace==='session')dependency(node,namespace,ref.id,origin,ref);
   else{node.entity.dependencies.push({namespace,id:text(ref.id),origin,scope:{...ref,resolution:'declaration-only'}});gap('unsupported-groups-reference',origin,ref,node);}
  });
 }
 const codexRouteParents:Array<{node:Node;threadId:string}>=[],codexNativeParents:Array<{node:Node;nativeSourceId:string;nativeId:string}>=[];
 function codexFact(fact:Row){
  const threads:Array<{node:Node;nativeId:string}>=[];
  list(fact.sources).forEach(value=>{const source=profileRecord(value),sourceId=text(source.sourceId);
   list(source.nativeSessions).forEach((value,i)=>{const row=profileRecord(value),path=`nativeSessions[${i}]`,node=add(sourceId,'codex','codex-session',text(row.id),path,row);
    // External persisted strings are never AgentSession or profile authority.
    gap('codex-external-owner',at(sourceId,path+'.owner'),row.owner,node);gap('codex-external-native-id',at(sourceId,path+'.nativeId'),row.nativeId,node);
   });
   list(source.threads).forEach((value,i)=>{const row=profileRecord(value),node=add(sourceId,'codex','codex-thread',text(row.threadId),`threads[${i}]`,row);threads.push({node,nativeId:text(row.nativeId)});});
   list(source.routes).forEach((value,i)=>{const row=profileRecord(value),path=`routes[${i}]`,node=add(sourceId,'codex','codex-route',text(row.taskId),path,row);dependency(node,'task',row.taskId,at(sourceId,path+'.taskId'),row);codexRouteParents.push({node,threadId:text(row.threadId)});});
  });
  for(const value of list(fact.pairs)){const pair=profileRecord(value);if(pair.state!=='paired'||typeof pair.nativeSourceId!=='string')continue;
   for(const entry of threads.filter(entry=>entry.node.entity.sourceId===pair.routesSourceId))codexNativeParents.push({node:entry.node,nativeSourceId:pair.nativeSourceId,nativeId:entry.nativeId});
  }
 }
 const loopParents:Array<{node:Node;parentKind:'loop'|'loop_run'|'loop_stage';parentId:string;loopId?:string;path:string}>=[];

 const loopTableIndex=new Map<string,Node[]>(),loopRecordParents:Array<{node:Node;table:string;id:string;origin:CapturedProfileOrigin;runId?:string}>=[],loopReferences:Array<{node:Node;table:string;id:string;origin:CapturedProfileOrigin;reference:Row}>=[];
 const loopPhysicalKey=(sourceId:string,table:string,id:string)=>json([sourceId,table,id]);
 function loopRow(fact:Row){
  if(fact.kind!=='row')return;
  const sourceId=text(fact.sourceId),table=text(fact.table),path=table+'['+text(fact.rowid)+']',row=decodeCapturedLoopRow(table,profileRecord(fact.cells) as Readonly<Record<string,CapturedSqliteCell>>);
  const kind=table==='loop_definitions'?'loop':table==='loop_runs'?'loop_run':table==='loop_stages'?'loop_stage':'loop-row',node=add(sourceId,'loop',kind,kind==='loop-row'?json([table,text(fact.rowid)]):text(row.id),path,fact);
  const identityColumns:Readonly<Record<string,string>>={loop_definitions:'id',loop_runs:'id',loop_stages:'id',completion_expectations:'id',completion_evidence:'id',completion_records:'id',loop_learned_constraints:'id',assistant_candidates:'id',loop_publication_candidates:'candidate_id',loop_native_attempts:'attempt_id',loop_verification_sessions:'id',loop_projection_origins:'run_id'};
  const column=identityColumns[table];if(column){const key=loopPhysicalKey(sourceId,table,text(row[column]));loopTableIndex.set(key,[...loopTableIndex.get(key)??[],node]);}
  const parent=(targetTable:string,id:unknown,column:string,runId?:string)=>{if(id===null||id===undefined)return;loopRecordParents.push({node,table:targetTable,id:text(id),origin:at(sourceId,path+'.cells.'+column),...runId===undefined?{}:{runId}});};
  if(kind==='loop_run')loopParents.push({node,parentKind:'loop',parentId:text(row.loop_id),path:path+'.cells.loop_id'});
  if(kind==='loop_stage')loopParents.push({node,parentKind:'loop_run',parentId:text(row.run_id),loopId:text(row.loop_id),path:path+'.cells.run_id'});
  switch(table){
   case 'user_loop_templates':case 'loop_publication_configs':case 'loop_learned_constraints':parent('loop_definitions',row.loop_id,'loop_id');break;
   case 'assistant_candidates':case 'loop_run_publication_basis':case 'loop_projection_origins':parent('loop_runs',row.run_id,'run_id');break;
   case 'loop_projection_generations':parent('loop_projection_origins',row.run_id,'run_id');break;
   case 'loop_producer_results':case 'loop_publication_candidates':if(row.stage_id===null)parent('loop_runs',row.run_id,'run_id');else parent('loop_stages',row.stage_id,'stage_id',text(row.run_id));break;
   case 'loop_stage_execution_results':parent('loop_stages',row.stage_id,'stage_id',text(row.run_id));break;
   case 'loop_native_attempts':case 'loop_publication_candidate_members':parent('loop_publication_candidates',row.candidate_id,'candidate_id');break;
   case 'loop_verification_sessions':case 'loop_publication_attempts':parent('loop_native_attempts',row.native_attempt_id,'native_attempt_id');break;
   case 'loop_verification_executions':parent('loop_verification_sessions',row.session_record_id,'session_record_id');break;
   case 'assistant_promotion_intents':parent('assistant_candidates',row.candidate_id,'candidate_id');break;
   case 'completion_expectations':case 'completion_evidence':case 'completion_records':if(row.owner_kind==='loop_run'||row.owner_kind==='loop_stage')parent(row.owner_kind==='loop_run'?'loop_runs':'loop_stages',row.owner_id,'owner_id');break;
   case 'evidence_anomalies':list(fact.references).forEach(value=>{const reference=profileRecord(value);if(reference.relation==='evidence_anomalies.scan_run')parent('loop_runs',reference.id,'metadata_json');});break;
  }
  const internal:Readonly<Record<string,string>>={'completion-expectation':'completion_expectations','completion-evidence':'completion_evidence','completion-record':'completion_records','loop-constraint':'loop_learned_constraints'};
  list(fact.references).forEach((value,i)=>{const reference=profileRecord(value),namespace=text(reference.namespace),relation=text(reference.relation),id=text(reference.id),origin=at(sourceId,path+`.references[${i}]`);
   const ownerRelation=relation===table+'.owner'&&(['completion_expectations','completion_evidence','completion_records','evidence_anomalies'].includes(table));
   const sessionRelation=namespace==='session'&&(relation==='loop_verification_sessions.session'||relation==='loop_stage_execution_results.task.session');
   const taskRelation=namespace==='task'&&(relation==='loop_stages.task'||ownerRelation||relation==='assistant_candidates.evidence');
   const goalRelation=namespace==='goal'&&ownerRelation;
   if(sessionRelation||taskRelation||goalRelation)dependency(node,namespace,id,origin,reference);
   else if(internal[namespace]&&(relation===table+'.evidence'||relation==='completion_records.expectation'||relation==='evidence_anomalies.completion_record'||relation==='loop_stages.injected_constraint')){node.entity.dependencies.push({namespace,id,origin,scope:reference});loopReferences.push({node,table:internal[namespace]!,id,origin,reference});}
   else{node.entity.dependencies.push({namespace,id,origin,scope:{...reference,resolution:'declaration-only'}});if(!(kind==='loop'&&relation==='loop_definitions.active_run'))gap('unsupported-loop-reference',origin,reference,node);}
  });
  if(kind==='loop-row')gap('unsupported-loop-record',at(sourceId,path),fact,node);
  if(table==='loop_stage_execution_results')list(fact.embeddedTasks).forEach((value,i)=>{const embedded=profileRecord(value),declaration=profileRecord(embedded.declaration),taskNode=task(sourceId,path+`.embeddedTasks[${i}].declaration`,declaration,'loop','loop-embedded-task',text(fact.rowid)+':'+i);loopParents.push({node:taskNode,parentKind:'loop_stage',parentId:text(row.stage_id),path:path+'.cells.stage_id',loopId:text(row.run_id)});if(embedded.completionObservation!==null)gap('unsupported-loop-completion-observation',at(sourceId,path+`.embeddedTasks[${i}].completionObservation`),embedded.completionObservation,taskNode);});
 }

 for(const event of events){if(event.kind!=='family-fact')continue;const fact=profileRecord(event.fact);
  if(event.family==='file'){
   files.push(fact);
   list(fact.sources).forEach(value=>{const source=profileRecord(value),id=text(source.sourceId);
    list(source.sessions).forEach((value,i)=>session(id,'file',`sessions[${i}]`,value));
    list(source.tasks).forEach((value,i)=>task(id,`tasks[${i}]`,value));
    list(source.goals).forEach((value,i)=>goal(id,'file',`goals[${i}]`,value));
    list(source.nativeGoals).forEach((value,i)=>gap('unsupported-entity',at(id,`nativeGoals[${i}]`),value));
   });
  }else if(event.family==='session')list(fact.sources).forEach(value=>{const source=profileRecord(value);list(source.sessions).forEach((value,i)=>session(text(source.sourceId),'session',`sessions[${i}]`,value));});
  else if(event.family==='goal')list(fact.sources).forEach(value=>{const source=profileRecord(value),id=text(source.sourceId);
   list(source.goals).forEach((value,i)=>goal(id,'goal',`goals[${i}].declaration`,profileRecord(value).declaration));
   list(source.taskBindings).forEach((value,i)=>{const binding=profileRecord(value);bindings.push({sourceId:id,goalId:text(binding.goalId),binding,path:`taskBindings[${i}]`});});
   list(source.contextTasks).forEach((value,i)=>{const context=profileRecord(value),targets=index.get(indexKey('goal',text(context.goalId)))?.filter(n=>n.entity.sourceId===id)??[];for(const node of targets)dependency(node,'task',context.taskId,at(id,`contextTasks[${i}].taskId`),{kind:'context-task',...context});});
  });
  else if(event.family==='artifact')artifactRow(fact);
  else if(event.family==='groups')groupsRow(fact);
  else if(event.family==='kswarm')kswarmRow(fact);
  else if(event.family==='codex')codexFact(fact);
  else if(event.family==='loop')loopRow(fact);
  else if(event.family!=='writer-lock'){
   // Keep the complete fixed producer event, including every original body.
   const sourceId=typeof fact.sourceId==='string'?fact.sourceId:complete.sources.find(s=>s.family===event.family)?.sourceId;
   if(sourceId)gap('unsupported-family',at(sourceId,'family'),{family:event.family,event:fact});
  }
 }


 // Compare complete actual constructed row population with original producer
 // frames independently; a retained raw event or gap is not a constructed node.
 const expectedLoopPopulation:unknown[]=[];
 for(const event of events){if(event.kind!=='family-fact'||event.family!=='loop')continue;const fact=profileRecord(event.fact);if(fact.kind!=='row')continue;const table=text(fact.table);expectedLoopPopulation.push({sourceId:text(fact.sourceId),path:table+'['+text(fact.rowid)+']',recordKind:table==='loop_definitions'?'loop':table==='loop_runs'?'loop_run':table==='loop_stages'?'loop_stage':'loop-row',original:fact});}
 const actualLoopPopulation=nodes.filter(node=>node.entity.family==='loop'&&node.entity.recordKind!=='loop-embedded-task').map(node=>({sourceId:node.entity.sourceId,path:node.entity.origin.path,recordKind:node.entity.recordKind,original:node.entity.original}));
 const orderedLoopPopulation=(values:unknown[])=>values.sort((a,b)=>{const left=profileRecord(a),right=profileRecord(b);return Buffer.compare(Buffer.from(json([left.sourceId,left.path])),Buffer.from(json([right.sourceId,right.path])));});
 if(!isDeepStrictEqual(orderedLoopPopulation(expectedLoopPopulation),orderedLoopPopulation(actualLoopPopulation)))throw Error('installed_metadata_loop_population');

 // Compare the complete producer population against actual built entities.
 // A retained mapper gap cannot compensate for a missing original KSwarm row.
 const expectedKSwarmPopulation:unknown[]=[];
 for(const event of events){if(event.kind!=='family-fact'||event.family!=='kswarm')continue;const fact=profileRecord(event.fact);if(fact.kind!=='row')continue;expectedKSwarmPopulation.push({sourceId:text(fact.sourceId),path:text(fact.table)+'['+text(fact.rowid)+']',recordKind:'kswarm-row',original:fact});}
 const actualKSwarmPopulation=nodes.filter(node=>node.entity.family==='kswarm').map(node=>({sourceId:node.entity.sourceId,path:node.entity.origin.path,recordKind:node.entity.recordKind,original:node.entity.original}));
 const orderedKSwarmPopulation=(values:unknown[])=>values.sort((a,b)=>{const left=profileRecord(a),right=profileRecord(b);return Buffer.compare(Buffer.from(json([left.sourceId,left.path])),Buffer.from(json([right.sourceId,right.path])));});
 if(!isDeepStrictEqual(orderedKSwarmPopulation(expectedKSwarmPopulation),orderedKSwarmPopulation(actualKSwarmPopulation)))throw Error('installed_metadata_kswarm_population');

 // Independent second pass over original producer frames. Compare ACTUAL
 // constructed entities, so a dropped builder node cannot retain a handle
 // merely by preserving an original complex gap or incrementing another count.
 const expectedIntentPopulation:Array<{sourceId:string;path:string;recordKind:Entity['recordKind'];original:unknown}>=[];
 for(const event of events){if(event.kind!=='family-fact'||!['file','session'].includes(event.family))continue;const fact=profileRecord(event.fact);
  for(const value of list(fact.sources)){const source=profileRecord(value),sourceId=text(source.sourceId);
   list(source.sessions).forEach((value,i)=>{const session=profileRecord(value),path=`sessions[${i}]`,sessionOrigin={sourceId,path};
    list(session.intentSubjects).forEach((value,j)=>{const subject=profileRecord(value);expectedIntentPopulation.push({sourceId,path:path+`.intentSubjects[${j}]`,recordKind:subject.stageId===null?'intent':'intent-stage',original:{subject:value,sessionOrigin}});});
    const publication=profileRecord(session.publicationDeclarations);list(publication.nativeContracts).forEach((value,j)=>expectedIntentPopulation.push({sourceId,path:path+`.publicationDeclarations.nativeContracts[${j}]`,recordKind:'intent-native-contract',original:{record:value,sessionOrigin}}));
   });
  }
 }
 const actualIntentPopulation=nodes.filter(node=>['intent','intent-stage','intent-native-contract'].includes(node.entity.recordKind)).map(node=>({sourceId:node.entity.sourceId,path:node.entity.origin.path,recordKind:node.entity.recordKind,original:node.entity.original})),intentPopulationKey=(value:{sourceId:string;path:string})=>json([value.sourceId,value.path]);
 const orderedIntentPopulation=<T extends {sourceId:string;path:string}>(rows:T[])=>rows.sort((a,b)=>Buffer.compare(Buffer.from(intentPopulationKey(a)),Buffer.from(intentPopulationKey(b))));
 if(!isDeepStrictEqual(orderedIntentPopulation(expectedIntentPopulation),orderedIntentPopulation(actualIntentPopulation)))throw Error('installed_metadata_intent_population');

 function unique(kind:string,id:string,origin:CapturedProfileOrigin,node?:Node){const targets=index.get(indexKey(kind,id))??[];if(targets.length!==1){gap(targets.length?'ambiguous-entity':'missing-entity',origin,{namespace:kind,id,count:targets.length},node);return undefined;}const target=targets[0]!;if(kind==='session'&&target.direct.length!==1){gap('session-identity-unresolved',origin,{namespace:kind,id,sourceId:target.entity.sourceId,original:target.entity.original},node);return undefined;}return target;}




 // Same-source downward aggregation does not feed Workspace/Lineage siblings
 // into a narrower Version, nor infer identity from metadata or file strings.
 for(const entry of artifactParents){const sourceId=entry.node.entity.sourceId,targets=(index.get(indexKey(entry.parentKind,entry.parentId))??[]).filter(node=>node.entity.sourceId===sourceId),origin=at(sourceId,entry.path);
  if(targets.length!==1){gap('artifact-parent-unresolved',origin,{parentKind:entry.parentKind,parentId:entry.parentId,count:targets.length},entry.node);continue;}
  targets[0]!.targets.push(entry.node);targets[0]!.entity.dependencies.push({namespace:entry.node.entity.recordKind,id:entry.node.entity.originalRecordKey,origin,scope:{sourceId,parentKind:entry.parentKind,parentId:entry.parentId,direction:'original-child'}});
 }
 // A Group aggregates only its original physical children; individual Agents
 // never inherit their Group's sibling population or active thread pointer.
 for(const entry of groupsParents){const sourceId=entry.node.entity.sourceId,targets=(index.get(indexKey('group',entry.groupId))??[]).filter(node=>node.entity.sourceId===sourceId),origin=at(sourceId,entry.path);
  if(targets.length!==1){gap('groups-parent-unresolved',origin,{groupId:entry.groupId,count:targets.length},entry.node);continue;}
  targets[0]!.targets.push(entry.node);targets[0]!.entity.dependencies.push({namespace:entry.node.entity.recordKind,id:entry.node.entity.originalRecordKey,origin,scope:{sourceId,groupId:entry.groupId,direction:'original-child'}});
 }
     // These are consumer links in the fixed original Codex schema, never global
 // thread-name/native-id/owner-string conversion into AgentSession identities.
 for(const entry of codexRouteParents){const sourceId=entry.node.entity.sourceId,targets=(index.get(indexKey('codex-thread',entry.threadId))??[]).filter(node=>node.entity.sourceId===sourceId),origin=at(sourceId,entry.node.entity.origin.path+'.threadId');
  if(targets.length!==1){gap('codex-thread-unresolved',origin,{threadId:entry.threadId,count:targets.length},entry.node);continue;}
  targets[0]!.targets.push(entry.node);targets[0]!.entity.dependencies.push({namespace:'codex-route',id:entry.node.entity.originalRecordKey,origin,scope:{sourceId,direction:'original-consumer'}});
 }
 for(const entry of codexNativeParents){const targets=(index.get(indexKey('codex-session',entry.nativeId))??[]).filter(node=>node.entity.sourceId===entry.nativeSourceId),origin=at(entry.node.entity.sourceId,entry.node.entity.origin.path+'.nativeId');
  if(targets.length!==1){gap('codex-native-unresolved',origin,{nativeSourceId:entry.nativeSourceId,nativeId:entry.nativeId,count:targets.length},entry.node);continue;}
  targets[0]!.targets.push(entry.node);targets[0]!.entity.dependencies.push({namespace:'codex-thread',id:entry.node.entity.originalRecordKey,origin,scope:{routesSourceId:entry.node.entity.sourceId,nativeSourceId:entry.nativeSourceId,direction:'original-consumer'}});
 }
 // Fixed exact-source forward edges only. A narrower Stage never points back
 // to its Run, nor a Run to its Loop, so siblings cannot feed its sessions.
 const validatedLoopParents=new Map<Node,Node>();
 for(const link of loopParents){
  const sourceId=link.node.entity.sourceId,parents=(index.get(indexKey(link.parentKind,link.parentId))??[]).filter(node=>node.entity.sourceId===sourceId);
  const origin=at(sourceId,link.path);
  if(parents.length!==1){gap(parents.length?'ambiguous-loop-parent':'missing-loop-parent',origin,{parentKind:link.parentKind,parentId:link.parentId,count:parents.length},link.node);continue;}
  const parent=parents[0]!,parentRow=decodeCapturedLoopRow(text(profileRecord(parent.entity.original).table),profileRecord(profileRecord(parent.entity.original).cells) as Readonly<Record<string,CapturedSqliteCell>>);
  if(link.loopId!==undefined&&((link.parentKind==='loop_run'?parentRow.loop_id:parentRow.run_id)!==link.loopId)){gap('loop-parent-scope-mismatch',origin,{parentKind:link.parentKind,parentId:link.parentId,scope:link.loopId},link.node);continue;}
  validatedLoopParents.set(link.node,parent);
  parent.targets.push(link.node);parent.entity.dependencies.push({namespace:link.node.entity.recordKind,id:link.node.entity.originalRecordKey,origin,scope:{sourceId,direction:'original-child',parentKind:link.parentKind,parentId:link.parentId}});
 }


 for(const entry of loopRecordParents){const sourceId=entry.node.entity.sourceId,parents=loopTableIndex.get(loopPhysicalKey(sourceId,entry.table,entry.id))??[];
  if(parents.length!==1){gap('loop-record-parent-unresolved',entry.origin,{table:entry.table,id:entry.id,count:parents.length,original:entry.node.entity.original},entry.node);continue;}
  const parent=parents[0]!,original=profileRecord(parent.entity.original),row=decodeCapturedLoopRow(text(original.table),profileRecord(original.cells) as Readonly<Record<string,CapturedSqliteCell>>);
  if(entry.runId!==undefined&&row.run_id!==entry.runId){gap('loop-record-parent-scope-mismatch',entry.origin,{table:entry.table,id:entry.id,runId:entry.runId,original:entry.node.entity.original},entry.node);continue;}
  parent.targets.push(entry.node);parent.entity.dependencies.push({namespace:'loop-row',id:entry.node.entity.originalRecordKey,origin:entry.origin,scope:{sourceId,table:entry.table,parentId:entry.id,direction:'original-child'}});
 }
 for(const entry of loopReferences){const targets=loopTableIndex.get(loopPhysicalKey(entry.node.entity.sourceId,entry.table,entry.id))??[];if(targets.length!==1){gap('loop-reference-unresolved',entry.origin,{...entry.reference,table:entry.table,count:targets.length},entry.node);continue;}entry.node.targets.push(targets[0]!);}

 // Native hashes deliberately omit loopId/runId/stageKind components. Only
 // the complete original subject and its validated physical parents can join.
 const nativeLoopIndex=new Map<string,Node[]>();
 for(const node of nodes){const kind=node.entity.recordKind;if(kind!=='loop_run'&&kind!=='loop_stage')continue;
  const parent=validatedLoopParents.get(node);if(!parent||kind==='loop_stage'&&!validatedLoopParents.has(parent))continue;
  const original=profileRecord(node.entity.original),row=decodeCapturedLoopRow(text(original.table),profileRecord(original.cells) as Readonly<Record<string,CapturedSqliteCell>>);
  try{const subject=parseLoopHostSubject({kind:'loop-run',loopId:row.loop_id,runId:kind==='loop_run'?row.id:row.run_id,stage:kind==='loop_stage'?{stageId:row.id,stageKind:row.stage_kind}:null}),key=json(subject);nativeLoopIndex.set(key,[...nativeLoopIndex.get(key)??[],node]);}
  catch{gap('native-loop-row-subject-unresolved',node.entity.origin,node.entity.original,node);}
 }


 // A child root is an explicit original physical namespace. It must not fall
 // back to another root that happens to contain the same Session filename.
 for(const entry of scopedSessionReferences){const sources=capture.facts.sources.map(value=>value.source).filter(source=>source.directory.canonicalPath===entry.root&&(source.kind==='session-root'||source.kind==='sqlite-db'&&source.snapshotFormat==='session-sqlite-v1'));
  if(sources.length!==1){gap('session-reference-unresolved',entry.origin,{...entry.reference,sourceCount:sources.length},entry.node);continue;}
  const sourceId=sources[0]!.sourceId,targets=(index.get(indexKey('session',entry.id))??[]).filter(node=>node.entity.sourceId===sourceId);
  if(targets.length!==1||targets[0]!.direct.length!==1){gap('session-reference-unresolved',entry.origin,{...entry.reference,sourceId,count:targets.length,directCount:targets[0]?.direct.length??0},entry.node);continue;}
  entry.node.targets.push(targets[0]!);
 }

 for(const node of nodes)for(const ref of node.pending){const target=unique(ref.namespace,ref.id,ref.origin,node);if(target)node.targets.push(target);}
 const bindingKey=(row:Row)=>capturedGoalTaskKey(row.taskId,{kind:'goal_turn',origin:row.origin,goalId:row.goalId,epoch:row.epoch,goalTurnId:row.goalTurnId,threadId:row.threadId});
 const bindingCounts=new Map<string,number>();for(const entry of bindings){const key=bindingKey(entry.binding);bindingCounts.set(key,(bindingCounts.get(key)??0)+1);}
 for(const entry of bindings){const key=bindingKey(entry.binding),targets=taskScopes.get(key)??[],goals=index.get(indexKey('goal',entry.goalId))?.filter(n=>n.entity.sourceId===entry.sourceId)??[];
  for(const node of goals){if(bindingCounts.get(key)!==1||targets.length!==1){gap('goal-task-binding-unresolved',at(entry.sourceId,entry.path),{binding:entry.binding,count:targets.length,bindingCount:bindingCounts.get(key)},node);continue;}node.targets.push(targets[0]!);node.entity.dependencies.push({namespace:'task',id:text(entry.binding.taskId),origin:at(entry.sourceId,entry.path),scope:{kind:'goal_turn',binding:entry.binding}});}
 }
 function exactSession(sourceId:string,id:string,origin:CapturedProfileOrigin,node:Node){const matches=(index.get(indexKey('session',id))??[]).filter(n=>n.entity.sourceId===sourceId);if(matches.length!==1||matches[0]!.direct.length!==1){gap('physical-session-unresolved',origin,{sourceId,sessionId:id,count:matches.length},node);return;}node.targets.push(matches[0]!);}
 for(const fact of files){
  list(fact.observationSides).forEach((value,i)=>{const side=profileRecord(value),taskNodes=list(side.taskIds).flatMap(id=>(index.get(indexKey('task',text(id)))??[]).filter(n=>n.entity.sourceId===side.taskSourceId));
   if(side.state!=='body'||list(side.missingReasons).length||typeof side.sessionSourceId!=='string')return;
   for(const node of taskNodes)exactSession(side.sessionSourceId,text(side.sessionIdentity),at(text(side.taskSourceId),`observationSides[${i}]`),node);
  });
  list(fact.aliases).forEach((value,i)=>{const alias=profileRecord(value),binding=profileRecord(alias.binding);if(alias.state!=='active'||alias.target!=='present'||!alias.marker||list(alias.unresolvedReasons).length)return;
   const sourceId=text(alias.canonicalSourceId),holders=list(fact.sources).map(profileRecord).filter(source=>source.kind==='task-root'&&source.directory===binding.holderRoot);
   for(const holder of holders)for(const node of (index.get(indexKey('task',text(binding.holderId)))??[]).filter(n=>n.entity.sourceId===holder.sourceId))exactSession(sourceId,text(binding.targetSessionId),at(sourceId,`aliases[${i}].binding.targetSessionId`),node);
  });
 }
 function traverse(start:Node):Session[]{const seen=new Set<Node>(),pending=[start],sessions:Session[]=[];while(pending.length){const node=pending.pop()!;if(seen.has(node))continue;seen.add(node);sessions.push(...node.direct);pending.push(...node.targets);}return union(sessions);}
 for(const node of nodes){node.entity.sessions=traverse(node);if(node.entity.recordKind==='codex-session'&&!node.entity.sessions.length)gap('codex-native-unresolved',node.entity.origin,node.entity.original,node);const source=sourceRows.get(node.entity.sourceId);if(!source)throw Error('installed_metadata_closure_population');source.sessions=union([...source.sessions,...node.entity.sessions]);}
 // Physical source cost attribution may include all its root entities. It is
 // kept separate from entity edges and cannot feed the Task/Goal traversal.
 const physicalEdges:Array<[string,string]>=[];for(const fact of files)for(const value of list(fact.sources)){const source=profileRecord(value);for(const ref of list(source.sourceReferences)){const reference=profileRecord(ref);physicalEdges.push([text(source.sourceId),text(reference.sourceId)]);}}
 const adjacency=new Map<string,string[]>();for(const[a,b]of physicalEdges){if(!sourceRows.has(a)||!sourceRows.has(b))throw Error('installed_metadata_closure_population');adjacency.set(a,[...(adjacency.get(a)??[]),b]);adjacency.set(b,[...(adjacency.get(b)??[]),a]);}
 const originalSourceSessions=new Map([...sourceRows].map(([id,source])=>[id,source.sessions]));for(const source of sourceRows.values()){const seen=new Set<string>(),pending=[source.sourceId],sessions:Session[]=[];while(pending.length){const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);sessions.push(...originalSourceSessions.get(id)!);pending.push(...adjacency.get(id)??[]);}source.sessions=union(sessions);}
 const set=capture.review.sourceSet;
 // A complete supplied set cannot prove absence of historical custom roots.
 gap('legacy-inventory-required',at(set.profileId,'profile'),{uid:set.uid,accountId:set.accountId,inventoryGeneration:set.inventoryGeneration});
 for(const profile of native.profiles)if(profile.uid!==set.uid||profile.accountId!==set.accountId||profile.profileId!==set.profileId)gap('profile-not-captured',at(native.resourceId,'profiles'),profile);
 native.unresolvedEnrollments.forEach((row,i)=>gap('native-enrollment-unresolved',at(native.resourceId,'unresolvedEnrollments['+i+']'),row));

 function nativeLoopTarget(owner:NativeFacts['ownerSessions'][number],note:(reason:string,detail?:unknown)=>void):Node|undefined{
  const logical=json({uid:owner.uid,accountGeneration:owner.accountId.toUpperCase(),ownerKind:owner.ownerKind,ownerId:owner.ownerId}),ownerKey=json({profileId:owner.profileId,ownerKind:owner.ownerKind,ownerId:owner.ownerId});
  const rows=(table:string)=>{const population=native.enrollmentPopulation.find(value=>value.table===table);return population?.present?population.rows:[];};
  const receipts=rows('owner_enrollment_loop_subjects').filter(row=>row.logical_owner_key===logical||row.owner_key===ownerKey),intents=rows('owner_enrollment_intents').filter(row=>row.logical_owner_key===logical);
  try{if(receipts.length!==1||intents.length!==1)throw Error('receipt-population');const receipt=receipts[0]!,intent=intents[0]!;
   if(receipt.logical_owner_key!==logical||receipt.owner_key!==ownerKey||intent.committed!==1||typeof receipt.subject_json!=='string'||receipt.subject_json!==intent.loop_subject_json)throw Error('receipt-scope');
   const subject=parseLoopHostSubject(JSON.parse(receipt.subject_json)),mapped=loopHostSubjectOwner(subject);if(json(subject)!==receipt.subject_json||mapped.ownerKind!==owner.ownerKind||mapped.ownerId!==owner.ownerId)throw Error('subject-scope');
   const registration=(raw:unknown)=>{if(typeof raw!=='string')throw Error('registration-type');const value=parseOwnerEnrollmentRegistration(JSON.parse(raw));if(json(value)!==raw)throw Error('registration-canonical');return value;},original=registration(receipt.registration_json),current=registration(intent.registration_json);
   if(original.migrationEpoch!==current.migrationEpoch||json(original.source)!==json(current.source)||original.obligations.length>current.obligations.length||json(original.obligations)!==json(current.obligations.slice(0,original.obligations.length)))throw Error('registration-prefix');
   const targets=nativeLoopIndex.get(json(subject))??[];if(targets.length!==1)throw Error('subject-population-'+targets.length);return targets[0];
  }catch(error){note('native-loop-subject-unresolved',{owner,receipts,intents,error:error instanceof Error?error.message:'invalid-original-subject'});return undefined;}
 }


 function nativeIntentTarget(owner:NativeFacts['ownerSessions'][number],note:(reason:string,detail?:unknown)=>void):Node|undefined{
  const logical=json({uid:owner.uid,accountGeneration:owner.accountId.toUpperCase(),ownerKind:owner.ownerKind,ownerId:owner.ownerId}),ownerKey=json({profileId:owner.profileId,ownerKind:owner.ownerKind,ownerId:owner.ownerId}),rows=(table:string)=>{const value=native.enrollmentPopulation.find(value=>value.table===table);return value?.present?value.rows:[];};
  const receipts=rows('owner_enrollment_intent_contracts').filter(row=>row.logical_owner_key===logical||row.owner_key===ownerKey),intents=rows('owner_enrollment_intents').filter(row=>row.logical_owner_key===logical);
  try{if(receipts.length!==1||intents.length!==1)throw Error('receipt-population');const receipt=receipts[0]!,intent=intents[0]!;
   if(receipt.logical_owner_key!==logical||receipt.owner_key!==ownerKey||intent.committed!==1||typeof receipt.contract_json!=='string'||receipt.contract_json!==intent.intent_contract_json)throw Error('receipt-scope');
   const binding=parseIntentContractEnrollment(JSON.parse(receipt.contract_json)),mapped=intentHostSubjectOwner(binding.subject);if(json(binding)!==receipt.contract_json||mapped.ownerKind!==owner.ownerKind||mapped.ownerId!==owner.ownerId)throw Error('subject-scope');
   const registration=(raw:unknown)=>{if(typeof raw!=='string')throw Error('registration-type');const value=parseOwnerEnrollmentRegistration(JSON.parse(raw));if(json(value)!==raw)throw Error('registration-canonical');return value;},current=registration(intent.registration_json),original=registration(receipt.registration_json),expected=intentContractOriginalRegistration(binding);
   for(const prior of [expected,original])if(prior.migrationEpoch!==current.migrationEpoch||json(prior.source)!==json(current.source)||prior.obligations.length>current.obligations.length||json(prior.obligations)!==json(current.obligations.slice(0,prior.obligations.length)))throw Error('registration-prefix');
   const targets=nativeIntentIndex.get(json(binding.subject))??[];if(targets.length!==1)throw Error('subject-population-'+targets.length);const target=targets[0]!,source=intentSessionOwners.get(target);if(!source||source.direct.length!==1)throw Error('physical-session-identity');
   const contracts=(sourceIntentContracts.get(source)??[]).filter(node=>{const record=profileRecord(profileRecord(node.entity.original).record);return record.intentId===binding.subject.intentId;});
   if(contracts.length!==1)throw Error('source-contract-population-'+contracts.length);const record=profileRecord(profileRecord(contracts[0]!.entity.original).record);
   if(json(record.contract)!==json(binding.contract)||!list(record.subjects).some(value=>profileRecord(value).stageId===binding.subject.stageId))throw Error('source-contract-scope');return target;
  }catch(error){note('native-intent-subject-unresolved',{owner,receipts,intents,error:error instanceof Error?error.message:'invalid-original-subject'});return undefined;}
 }

 const nativeOwners=native.ownerSessions.map((owner,i)=>{const origin=at(native.resourceId,`ownerSessions[${i}]`),pending:Unresolved[]=[],sessions:Session[]=[];
  const note=(reason:string,detail?:unknown)=>{const value={reason,origin,...detail===undefined?{}:{detail}};pending.push(value);unresolved.push(value);};
  if(owner.uid!==set.uid||owner.accountId!==set.accountId||owner.profileId!==set.profileId){note('profile-not-captured',owner);return {owner,sessions,unresolved:pending};}
  const target=owner.ownerKind==='loop'?nativeLoopTarget(owner,note):owner.ownerKind==='intent'?nativeIntentTarget(owner,note):unique(owner.ownerKind,owner.ownerId,origin);if(target)sessions.push(...target.entity.sessions);
  for(const id of owner.sessionIdentities){const session=unique('session',id,origin);if(session?.direct.length)sessions.push(...session.entity.sessions);else note('native-session-unresolved',{sessionId:id});}
  const resolved=union(sessions);if(!target||!resolved.length)note('native-owner-unresolved',owner);
  return {owner,sessions:resolved,unresolved:pending};
 });
 return freezeCapturedData({version:1 as const,kind:'installed-metadata-closure-facts' as const,capture,native,mapper:{events,complete},sources:[...sourceRows.values()],entities:nodes.map(n=>n.entity),nativeOwners,unresolved});
}

type Facts=ReturnType<typeof joinFacts>;
interface Stored {lifetime:InstalledControllerLifetime;owner:object;token:object;source:object;capture:CaptureFacts;native:NativeFacts;facts:Facts}
const closures=new WeakMap<object,Stored>();
function current(value:Stored){
 const capture=readInstalledProfileSourceCapture(value.lifetime,value.owner,value.token),native=readInstalledMetadataSessionFacts(value.lifetime,value.source);
 if(capture.facts!==value.capture.facts||capture.review!==value.capture.review||capture.manifestHash!==value.capture.manifestHash||capture.manifestBytes!==value.capture.manifestBytes||capture.capturedBytes!==value.capture.capturedBytes||!isDeepStrictEqual(native,value.native))throw Error('installed_metadata_closure_changed');
}
function stored(lifetime:InstalledControllerLifetime,handle:object){const value=closures.get(handle);if(!value||value.lifetime!==lifetime)throw Error('installed_metadata_closure_brand');current(value);return value;}

/** Four original objects only; never an iterable, session DTO or checker. */
export async function collectInstalledMetadataClosure(lifetime:InstalledControllerLifetime,owner:object,token:object,source:object):Promise<object>{
 if(arguments.length!==4)throw Error('installed_metadata_closure_arguments');
 const capture=readInstalledProfileSourceCapture(lifetime,owner,token),native=readInstalledMetadataSessionFacts(lifetime,source),set=capture.review.sourceSet;
 if(capture.review.authorityId!==native.authorityId||set.authorityId!==native.authorityId||capture.facts.uid!==set.uid||!native.profiles.some(profile=>profile.uid===set.uid&&profile.accountId===set.accountId&&profile.profileId===set.profileId))throw Error('installed_metadata_closure_profile');
 const value={lifetime,owner,token,source,capture,native} as Stored;
 current(value);await checkInstalledProfileSourceCapture(lifetime,owner,token);current(value);
 const iterator=iterateCapturedProfileDeclarations(owner,token),events:CapturedProfileEvent[]=[];let complete:Complete|undefined,exhausted=false;
 try{for(;;){current(value);const step=await iterator.next();current(value);if(step.done){exhausted=true;break;}if(complete)throw Error('installed_metadata_closure_population');events.push(step.value);if(step.value.kind==='complete')complete=step.value;}}
 finally{if(!exhausted)await iterator.return();}
 if(!complete)throw Error('installed_metadata_closure_population');
 const expected=capture.facts.sources.map(row=>({sourceId:row.source.sourceId,snapshotHash:row.snapshotHash})).sort((a,b)=>Buffer.compare(Buffer.from(a.sourceId),Buffer.from(b.sourceId))),actual=complete.sources.map(row=>({sourceId:row.sourceId,snapshotHash:row.snapshotHash}));
 if(!isDeepStrictEqual(expected,actual))throw Error('installed_metadata_closure_population');
 current(value);await checkInstalledProfileSourceCapture(lifetime,owner,token);current(value);
 value.facts=joinFacts(capture,native,events,complete);current(value);
 const handle=Object.freeze({});closures.set(handle,value);return handle;
}
/** Synchronous facts require the original lifetime and source population; a
 * later physical await must additionally use the actual async CHECK. */
export function readInstalledMetadataClosure(lifetime:InstalledControllerLifetime,handle:object){if(arguments.length!==2)throw Error('installed_metadata_closure_arguments');return stored(lifetime,handle).facts;}
export async function checkInstalledMetadataClosure(lifetime:InstalledControllerLifetime,handle:object):Promise<void>{if(arguments.length!==2)throw Error('installed_metadata_closure_arguments');const value=stored(lifetime,handle);await checkInstalledProfileSourceCapture(lifetime,value.owner,value.token);current(value);}
/** Exact original capture linkage, never a caller-provided closure DTO. */
export function assertInstalledMetadataClosureCapture(lifetime:InstalledControllerLifetime,handle:object,owner:object,token:object):void{
 if(arguments.length!==4)throw Error('installed_metadata_closure_arguments');
 const value=stored(lifetime,handle);if(value.owner!==owner||value.token!==token)throw Error('installed_metadata_closure_capture');
}
