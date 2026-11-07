import {performance} from 'node:perf_hooks';
import type {DshGithubReadAuthority} from './desktop-multi-agent-store.js';
import {types} from 'node:util';
import {captureGithubReadData,githubReadFields as fields,githubReadRecord as record,githubReadText as text,githubReadId as id,githubReadHash as hash,githubReadFreeze as freeze,githubReadMap as map,githubReadSort as sort,parseGithubBoundRepository,parseGithubParentIssue,matchGithubCreation,type GithubObjectV1,type GithubParentIssue} from './dsh-github-read-data.js';
import {planGithubGet,planGithubNextPage,type GithubGetInput} from './dsh-github-read-plan.js';
import {isOriginalGithubSourceSession,readOriginalGithubSessionRead,assertOriginalGithubSourceSessionOrigin,readOriginalGithubBindingContext,readOriginalGithubSourceAdmissionWindows,readOriginalGithubSessionProviderDateForContext,type GithubProviderDateFact,type MainGithubSourceSession,type GithubSessionCustodyReceipt} from './dsh-github-source-session.js';
import {parseGithubSourceScan,type GithubSourceScan,type GithubStoredRead,type GithubStoredSnapshot,type GithubSelectedParent} from './dsh-github-source-storage.js';
import {dshAAuth,type DshARecord as R} from '../../src/runtime/multi-agent/dsh-admission-data.js';
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,isProxy=types.isProxy,own=Object.hasOwn,now=performance.now,NativeDate=Date,dateString=Date.prototype.toISOString,dateParse=Date.parse,safe=Number.isSafeInteger;
const NativeError=Error,isArray=Array.isArray,create=Object.create;
const NativeWeakMap=WeakMap,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
const localErrors=new NativeWeakMap<object,string>();
const scans=new NativeWeakMap<object,{session:MainGithubSourceSession;data:GithubSourceScan;bindingId:string;credentialEpoch:number;qualification:'unqualified'|'budget_qualified';authority:ReturnType<typeof readOriginalGithubBindingContext>;providerDateFact:GithubProviderDateFact|null}>();
function fail(code='DSH_GITHUB_SCAN_INVALID'):never{const error=new NativeError(code);apply(set,localErrors,[error,code]);throw error;}
function stamp():string{return apply(dateString,new NativeDate(),[]) as string;}
function array(value:unknown):unknown[]{if(!isArray(value))fail();return value;}
function integer(value:unknown,min:number):number{if(typeof value!=='number'||!safe(value)||value<min)fail();return value;}
function method(session:MainGithubSourceSession,key:'read'|'getStatus'):Function{const row=descriptor(session,key);if(!row||!own(row,'value')||typeof row.value!=='function')fail();return row.value;}
export interface GithubSourceScanReceipt {data:GithubSourceScan;qualification:'unqualified'|'budget_qualified';authority:DshGithubReadAuthority|null;requestProof:object|null;providerDateFact:GithubProviderDateFact|null;assertCurrent():void}
/** Original aggregate custody only; original A and budget still authenticate their own capabilities. */
export function readOriginalGithubSourceScan(session:unknown,token:unknown,realm?:unknown,store?:unknown,authoritySource?:unknown):GithubSourceScanReceipt {
 if(!isOriginalGithubSourceSession(session)||!token||typeof token!=='object'||isProxy(token))fail('DSH_GITHUB_SCAN_RECEIPT_REQUIRED');
 const found=apply(get,scans,[token]) as {session:MainGithubSourceSession;data:GithubSourceScan;bindingId:string;credentialEpoch:number;qualification:'unqualified'|'budget_qualified';authority:ReturnType<typeof readOriginalGithubBindingContext>;providerDateFact:GithubProviderDateFact|null}|undefined;
 if(!found||found.session!==session)fail('DSH_GITHUB_SCAN_RECEIPT_REQUIRED');if(realm!==undefined||store!==undefined||authoritySource!==undefined){assertOriginalGithubSourceSessionOrigin(session,realm,store,authoritySource);if(!found.authority||found.qualification!=='budget_qualified')fail('DSH_GITHUB_SCAN_AUTHORITY_REQUIRED');}const status=method(session,'getStatus');
 return freeze({data:found.data,qualification:found.qualification,authority:found.authority?.view??null,requestProof:found.authority?.proof??null,providerDateFact:found.providerDateFact,assertCurrent(){found.authority?.view.assertLocal();const current=apply(status,session,[]) as ReturnType<MainGithubSourceSession['getStatus']>;if(current.state!=='connected'||current.sourceBindingId!==found.bindingId||current.credentialEpoch!==found.credentialEpoch)fail('DSH_GITHUB_SCAN_STALE');}});
}
/** A token cannot reconstruct a session or current provider authority after restart.
 * Only the original private token/session and fixed A tuple can expose this view. */
export function readOriginalGithubSourceScanForAdmission(token:unknown,realm:unknown,store:unknown,source:unknown):GithubSourceScanReceipt {
 if(!token||typeof token!=='object'||isProxy(token)||!realm||typeof realm!=='object'||isProxy(realm)||!store||typeof store!=='object'||isProxy(store)||!source||typeof source!=='object'||isProxy(source))fail('DSH_GITHUB_SCAN_RECEIPT_REQUIRED');
 const row=apply(get,scans,[token]) as {session:MainGithubSourceSession}|undefined;if(!row)fail('DSH_GITHUB_SCAN_RECEIPT_REQUIRED');
 return readOriginalGithubSourceScan(row.session,token,realm,store,source);
}
/** One bounded scan on the original session; no timer, database, retry or credential owner. */
export async function collectGithubSourceScan(rawSession:unknown,rawInput:unknown,context:unknown):Promise<{token:object;diagnostics:{attemptCountUpperBound:number;responseBytes:number;reason:string|null}}> {
 if(!isOriginalGithubSourceSession(rawSession))fail('DSH_GITHUB_SESSION_REQUIRED');const session=rawSession,read=method(session,'read'),getStatus=method(session,'getStatus');
 const input=record(captureGithubReadData(rawInput));fields(input,['schemaVersion','scanId','bindingId','bindingRevision','boundRepository','authScope','sourceBindingVersion','actorMappingVersion','provenanceVersion','selection','issueRefs','previousCheckpointRevision','since',...(own(input,'candidateIssueRefs')?['candidateIssueRefs']:[])]);if(input.schemaVersion!==1)fail();text(input.scanId);text(input.bindingId);integer(input.bindingRevision,1);for(const key of ['sourceBindingVersion','actorMappingVersion','provenanceVersion'])integer(input[key],1);integer(input.previousCheckpointRevision,0);
 const bound=parseGithubBoundRepository(input.boundRepository);dshAAuth(input.authScope);const authScope=input.authScope;if(authScope.repositoryId!==bound.repositoryId)fail();
 const selection=record(input.selection),refs:GithubParentIssue[]=[];if(selection.kind==='issue_ids'){fields(selection,['kind','issueIds']);const ids=sort(map(array(selection.issueIds),id));if(!ids.length)fail();const rawRefs=array(input.issueRefs);for(let i=0;i<rawRefs.length;i++)refs[refs.length]=parseGithubParentIssue(rawRefs[i],bound);const refIds=sort(map(refs,r=>r.issueId));for(let i=0;i<refIds.length;i++){let found=false;for(let j=0;j<ids.length;j++)if(refIds[i]===ids[j])found=true;if(!found)fail();}}else{fields(selection,['kind','match','labelIds']);if(selection.kind!=='label_ids'||selection.match!=='all'||!array(selection.labelIds).length||array(input.issueRefs).length)fail();}
 // A full selected set is enumerated here. A prior since hint never trims away source context.
 const startedAt=stamp(),born=apply(now,performance,[]) as number;let attempts=0,bytes=0,reason:string|null=null,allMeterQualified=true,selectedFinished=false;let providerDateFact:GithubProviderDateFact|null=null;
 const reads:GithubStoredRead[]=[],snapshots:GithubStoredSnapshot[]=[],parents:GithubSelectedParent[]=[],issueListAttemptIds:string[]=[];
 const current=()=>{const state=apply(getStatus,session,[]) as ReturnType<MainGithubSourceSession['getStatus']>;if(state.state!=='connected'||state.sourceBindingId!==input.bindingId||state.credentialEpoch!==authScope.credentialEpoch)fail('DSH_GITHUB_SCAN_STALE');};
 async function getOne(planInput:GithubGetInput|{schemaVersion:1;kind:'issue_identity';boundRepository:typeof bound;expectedIssueId:string;issueNumber:number}):Promise<{receipt:GithubSessionCustodyReceipt;read:GithubStoredRead}> {
  current();if(attempts>=64||bytes>=4*1024*1024||(apply(now,performance,[]) as number)-born>=30000)fail('DSH_GITHUB_SCAN_LIMIT');attempts++;
  const result=await apply(read,session,[planInput,context]);const receipt=readOriginalGithubSessionRead(session,result);if(receipt.plan.kind==='repository_discovery'||receipt.page.kind==='repository_discovery'||receipt.credentialEpoch===null)fail('DSH_GITHUB_SCAN_BOUND_READ_REQUIRED');if(receipt.meter.kind!=='original_budget_settled')allMeterQualified=false;else if(receipt.meter.scanId!==input.scanId||receipt.meter.attemptId!==receipt.attemptId)fail('DSH_GITHUB_SCAN_METER_SCOPE');bytes+=receipt.bytes;if(bytes>4*1024*1024||(apply(now,performance,[]) as number)-born>30000)fail('DSH_GITHUB_SCAN_LIMIT');current();
  if(receipt.plan.kind==='repository')providerDateFact=readOriginalGithubSessionProviderDateForContext(session,result,context);
  const page=receipt.page,entries='entries'in page?page.entries:[page.entry],stored:R[]=[];
  for(let i=0;i<entries.length;i++){const entry=entries[i]!;if(entry.kind!=='value'){stored[stored.length]=entry;continue;}
   if(page.kind==='issue'||page.kind==='comment'||page.kind==='issues'||page.kind==='issue_comments'||page.kind==='events'||page.kind==='issue_identity'){
    const event=page.kind==='events'?entry.value as import('./dsh-github-read-data.js').GithubEvent:null;
    const object=event?event.object:entry.value as GithubObjectV1,role=event?'event_payload':'current';
    const snapshotId='dsh-snapshot:'+hash('dsh-source-snapshot-v1',[input.bindingId,receipt.attemptId,i,role,object]);
    snapshots[snapshots.length]={schemaVersion:1,snapshotId,bindingId:input.bindingId as string,bindingRevision:input.bindingRevision as number,readAttemptId:receipt.attemptId,entryIndex:i,role,object};
    if(event){const{object:_object,...data}=event;stored[stored.length]={kind:'value',event:{...data,objectSnapshotId:snapshotId}};}else stored[stored.length]={kind:'value',snapshotId};
   }else stored[stored.length]=entry;
  }
  const storedPage:R={kind:page.kind,completeness:page.completeness,...('entries'in page?{entries:stored}:{entry:stored[0]})};
  const value:GithubStoredRead={schemaVersion:1,scanId:input.scanId as string,attemptId:receipt.attemptId,reservationRef:receipt.reservationRef,plan:receipt.plan,status:receipt.status,rawBodyHash:page.rawBodyHash,responseBytes:receipt.bytes,etag:receipt.headers.etag,requestId:receipt.headers.requestId,link:receipt.headers.link,retryAfter:receipt.headers.retryAfter,sourceSnapshotAt:receipt.sourceSnapshotAt,connectionEpoch:receipt.credentialEpoch,physical:receipt.physical,meter:receipt.meter.kind==='original_budget_settled'?'settled':'unknown',result:{kind:'decoded',page:storedPage}};
  reads[reads.length]=value;return{receipt,read:value};
 }
 async function list(first:GithubGetInput):Promise<GithubStoredRead[]> {let plan=planGithubGet(first);const result:GithubStoredRead[]=[];for(;;){const value=await getOne(first);result[result.length]=value.read;const next=planGithubNextPage(plan,value.receipt.headers.link,bound);if(next.kind==='end')return result;if(next.kind!=='next')fail('DSH_GITHUB_SCAN_PAGINATION_UNKNOWN');plan=next.plan;first={...first,page:plan.page!} as GithubGetInput;}}
 try {
  await getOne({schemaVersion:1,kind:'repository',boundRepository:bound});
  if(selection.kind==='issue_ids'){
   const wanted=array(selection.issueIds),candidates=own(input,'candidateIssueRefs')?array(input.candidateIssueRefs):[];
   for(let i=0;i<wanted.length;i++){const issueId=id(wanted[i]);let found=false;for(let j=0;j<refs.length;j++)if(refs[j]!.issueId===issueId)found=true;if(found)continue;
    let candidate:{issueId:string;issueNumber:number}|undefined;for(let j=0;j<candidates.length;j++){const r=record(candidates[j]);fields(r,['issueId','issueNumber']);if(r.issueId===issueId)candidate={issueId,issueNumber:integer(r.issueNumber,1)};}
    if(!candidate)fail('DSH_GITHUB_ISSUE_REFERENCE_UNCONFIRMED');
    const identity=await getOne({schemaVersion:1,kind:'issue_identity',boundRepository:bound,expectedIssueId:issueId,issueNumber:candidate.issueNumber}),page=identity.receipt.page;
    if(page.kind!=='issue_identity'||page.entry.kind!=='value')fail('DSH_GITHUB_ISSUE_REFERENCE_MISMATCH');const object=page.entry.value;
    refs[refs.length]={repositoryId:bound.repositoryId,issueId:object.issueId,nodeId:object.issueNodeId,number:object.issueNumber,isPullRequest:false};
   }
  }
  if(selection.kind==='label_ids'){
   const labels=await list({schemaVersion:1,kind:'labels',boundRepository:bound,page:1}),names:string[]=[];const selectedIds=sort(map(array(selection.labelIds),id));
   for(let i=0;i<labels.length;i++){const entries=array(record(labels[i]!.result.page).entries);for(let j=0;j<entries.length;j++){const e=record(entries[j]);if(e.kind==='value'){const value=record(e.value);for(let k=0;k<selectedIds.length;k++)if(value.id===selectedIds[k])names[names.length]=text(value.name);}}}
   if(names.length!==selectedIds.length)fail('DSH_GITHUB_SCAN_LABEL_UNKNOWN');const issues=await list({schemaVersion:1,kind:'issues',boundRepository:bound,page:1,since:null,labelNames:sort(names)});
   for(let i=0;i<issues.length;i++){issueListAttemptIds[issueListAttemptIds.length]=issues[i]!.attemptId;const entries=array(record(issues[i]!.result.page).entries);for(let j=0;j<entries.length;j++){const e=record(entries[j]);if(e.kind==='value'){let object:GithubObjectV1|undefined;for(let k=0;k<snapshots.length;k++)if(snapshots[k]!.snapshotId===e.snapshotId)object=snapshots[k]!.object;if(!object)fail();refs[refs.length]={repositoryId:bound.repositoryId,issueId:object.issueId,nodeId:object.issueNodeId,number:object.issueNumber,isPullRequest:false};}}}
  }
  sort(refs,(a,b)=>a.issueId<b.issueId?-1:a.issueId>b.issueId?1:0);
  for(let i=0;i<refs.length;i++){const parent=refs[i]!,value=await getOne({schemaVersion:1,kind:'issue',boundRepository:bound,parentIssue:parent});const entry=record(record(value.read.result.page).entry);if(entry.kind!=='value')fail('DSH_GITHUB_SCAN_PARENT_UNKNOWN');const selectedParent:GithubSelectedParent={issueId:parent.issueId,parentReadAttemptId:value.read.attemptId,parentSnapshotId:text(entry.snapshotId),commentListAttemptIds:[],selectedSnapshotIds:[text(entry.snapshotId)]};parents[parents.length]=selectedParent;
   const pages=await list({schemaVersion:1,kind:'issue_comments',boundRepository:bound,parentIssue:parent,page:1,since:null});for(let j=0;j<pages.length;j++){selectedParent.commentListAttemptIds[selectedParent.commentListAttemptIds.length]=pages[j]!.attemptId;const entries=array(record(pages[j]!.result.page).entries);for(let k=0;k<entries.length;k++){const e=record(entries[k]);if(e.kind==='value')selectedParent.selectedSnapshotIds[selectedParent.selectedSnapshotIds.length]=text(e.snapshotId);}}sort(selectedParent.selectedSnapshotIds);
  }
  selectedFinished=true;
  // Bounded event observation starts at page1 every time; it never creates an event skip cursor.
  await list({schemaVersion:1,kind:'events',boundRepository:bound,page:1});
 }catch(error){reason=error&&typeof error==='object'&&!isProxy(error)?apply(get,localErrors,[error]) as string|undefined??'DSH_GITHUB_SCAN_UNKNOWN':'DSH_GITHUB_SCAN_UNKNOWN';}
 current();const completedAt=stamp();
 let selectedComplete=selectedFinished&&allMeterQualified;for(let i=0;i<reads.length;i++){const r=reads[i]!;if(r.plan.kind!=='events'&&r.result.kind==='decoded'&&record(r.result.page).completeness!=='complete')selectedComplete=false;}
 const selected={schemaVersion:1 as const,readSetId:'',scanId:input.scanId as string,bindingId:input.bindingId as string,selection,issueListAttemptIds,parents,pagination:(selectedComplete?'complete':'partial') as 'complete'|'partial'};
 selected.readSetId='dsh-read-set:'+hash('dsh-source-read-set-v1',{...selected,readSetId:null});
 const candidates:R[]=[],admission=readOriginalGithubSourceAdmissionWindows(session,context);
 for(let i=0;i<parents.length;i++){const parent=parents[i]!;for(let j=0;j<parent.selectedSnapshotIds.length;j++){let snapshot:GithubStoredSnapshot|undefined,read:GithubStoredRead|undefined;for(let k=0;k<snapshots.length;k++)if(snapshots[k]!.snapshotId===parent.selectedSnapshotIds[j])snapshot=snapshots[k];if(!snapshot)fail();for(let k=0;k<reads.length;k++)if(reads[k]!.attemptId===snapshot.readAttemptId)read=reads[k];if(!read)fail();const object=snapshot.object;
  const envelope={thread:{sourceBindingId:input.bindingId,tenantId:authScope.tenantId,workspaceId:authScope.workspaceId,provider:'github',repositoryId:bound.repositoryId,kind:'issue',threadId:object.issueId},authScope,providerEventId:null,objectKind:object.objectKind,objectId:object.objectId,providerRevision:object.representationTag,contentHash:object.contentHash,receivedAt:read.sourceSnapshotAt,objectAuthorId:object.authorId,actorEvidence:{kind:'unknown',reason:'POLLING_ACTOR_UNPROVEN'},actorMappingVersion:input.actorMappingVersion,provenanceVersion:input.provenanceVersion,actorEvidenceHash:hash('dsh-github-polling-actor-unknown-v1',{repositoryId:bound.repositoryId,objectKind:object.objectKind,objectId:object.objectId,providerRevision:object.representationTag,contentHash:object.contentHash}),kind:'snapshot',trust:'external_untrusted',snapshotRef:snapshot.snapshotId,completeness:object.completeness,paginationComplete:selectedComplete,authorizationCheckedAt:read.sourceSnapshotAt};
  candidates[candidates.length]={currentSnapshotId:snapshot.snapshotId,eventReadAttemptId:null,eventEntryIndex:null,matchContext:null,envelope,comparison:null};
  // A selected snapshot remains a source-control input. A separately keyed
  // creation candidate needs an original live Window and actual event payload.
  if(!selectedComplete||read.etag===null||admission.sourceSnapshotAt===null)continue;
  let parentObject:GithubObjectV1|undefined;for(let k=0;k<snapshots.length;k++)if(snapshots[k]!.snapshotId===parent.parentSnapshotId)parentObject=snapshots[k]!.object;if(!parentObject)fail();
  let matched=false;
  for(let w=0;w<admission.windows.length&&!matched;w++){
   const window=admission.windows[w]!;window.assertCurrent();
   const matchContext={schemaVersion:1,boundRepository:bound,parentIssue:{repositoryId:bound.repositoryId,issueId:parentObject.issueId,nodeId:parentObject.issueNodeId,number:parentObject.issueNumber,isPullRequest:false},selector:selection.kind==='label_ids'?{...selection,parentIssueLabelIds:parentObject.labelIds}:selection,window:{effectiveAt:window.window.effectiveAt,observationsEndAt:window.observationsEndAt,sourceSnapshotAt:admission.sourceSnapshotAt},currentRepresentationTag:object.representationTag,currentFreshness:'current',pagination:selected.pagination};
   for(let e=0;e<reads.length&&!matched;e++){
    const eventRead=reads[e]!;if(eventRead.plan.kind!=='events'||eventRead.result.kind!=='decoded'||eventRead.meter!=='settled')continue;
    const entries=array(record(eventRead.result.page).entries);
    for(let n=0;n<entries.length&&!matched;n++){
     const entry=record(entries[n]);if(entry.kind!=='value')continue;const event=record(entry.event);if(dateParse(text(event.createdAt))<=dateParse(window.window.effectiveAt))continue;let payload:GithubStoredSnapshot|undefined;for(let k=0;k<snapshots.length;k++)if(snapshots[k]!.snapshotId===event.objectSnapshotId)payload=snapshots[k];if(!payload)fail();const{objectSnapshotId:_snapshot,...eventData}=event;
     const evidence=matchGithubCreation({...eventData,object:payload.object},object,matchContext);if(evidence.kind!=='matched')continue;
     window.assertLocal();current();
     const eventRef='dsh-github-event:'+hash('dsh-github-event-ref-v1',[bound.repositoryId,evidence.eventId,evidence.eventPayloadHash]);const created={...envelope,providerEventId:evidence.eventId,providerOccurredAt:evidence.eventCreatedAt,providerTimeEvidenceRef:eventRef,kind:'created',actorEvidence:{kind:'verified_event',triggerActorId:evidence.triggerActorId,eventRef},actorEvidenceHash:evidence.eventPayloadHash};
     candidates[candidates.length]={currentSnapshotId:snapshot.snapshotId,eventReadAttemptId:eventRead.attemptId,eventEntryIndex:n,matchContext,envelope:created,comparison:null};matched=true;
    }
   }
  }
 }}
 const data=parseGithubSourceScan({schemaVersion:1,scanId:input.scanId,bindingId:input.bindingId,bindingRevision:input.bindingRevision,boundRepository:bound,authScope,sourceBindingVersion:input.sourceBindingVersion,actorMappingVersion:input.actorMappingVersion,provenanceVersion:input.provenanceVersion,selection,startedAt,completedAt,previousCheckpointRevision:input.previousCheckpointRevision,reads,snapshots,selected,candidates,contentCheckpoint:selectedComplete?{schemaVersion:1,bindingId:input.bindingId,expectedRevision:input.previousCheckpointRevision,scanId:input.scanId,selectedReadSetId:selected.readSetId,since:null,overlapSeconds:300,lastFullReconcileScanId:input.scanId}:null});
 const token=freeze(create(null)) as object;apply(set,scans,[token,{session,data,bindingId:input.bindingId,credentialEpoch:authScope.credentialEpoch,qualification:allMeterQualified?'budget_qualified':'unqualified',authority:readOriginalGithubBindingContext(session,context),providerDateFact}]);
 return freeze({token,diagnostics:{attemptCountUpperBound:attempts,responseBytes:bytes,reason:reason??(allMeterQualified?null:'ORIGINAL_SOURCE_READ_METER_UNQUALIFIED')}});
}
