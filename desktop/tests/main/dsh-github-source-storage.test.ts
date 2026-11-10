// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {DSH_A_DDL} from '../../../src/runtime/multi-agent/dsh-admission-data.js';
import {DSH_A_AUTHORITY_DDL} from '../../../src/runtime/multi-agent/dsh-admission-authority-data.js';
import { decodeGithubObject, githubReadHash, matchGithubCreation } from '../../electron/dsh-github-read-data.js';
import { planGithubGet } from '../../electron/dsh-github-read-plan.js';
import { parseGithubSourceScan, planGithubSourceRows, readGithubSourceRow, validateGithubSourceRelations, DSH_GITHUB_SOURCE_DDL } from '../../electron/dsh-github-source-storage.js';
const bound = { repositoryId:'123',nodeId:'R_123',owner:'octo',repo:'demo' };
const parent = {repositoryId:'123',issueId:'42',nodeId:'I_42',number:1,isPullRequest:false};
const time='2026-11-06T00:00:00Z';
function fixture(body:string|null='正文\noriginal',title='标题') {
 const entry=decodeGithubObject({schemaVersion:1,kind:'issue',raw:{id:42,node_id:'I_42',number:1,user:{id:12,node_id:'U_12'},title,body,created_at:time,updated_at:time,labels:[],state:'open',locked:false,repository_url:'https://api.github.com/repos/octo/demo'},boundRepository:bound,parentIssue:parent,representationTag:'"rev1"'});
 if(entry.kind!=='value')throw Error('fixture');
 const snapshot={schemaVersion:1,snapshotId:'',bindingId:'binding',bindingRevision:1,readAttemptId:'read-1',entryIndex:0,role:'current',object:{...entry.value}};
 snapshot.snapshotId='dsh-snapshot:'+githubReadHash('dsh-source-snapshot-v1',[snapshot.bindingId,snapshot.readAttemptId,snapshot.entryIndex,snapshot.role,snapshot.object]);
 const comments={schemaVersion:1,scanId:'scan',attemptId:'read-2',reservationRef:'res-2',plan:planGithubGet({schemaVersion:1,kind:'issue_comments',boundRepository:bound,parentIssue:parent,page:1,since:null}),status:200,rawBodyHash:'a'.repeat(64),responseBytes:2,etag:'"comments"',requestId:null,link:null as string|null,retryAfter:null,sourceSnapshotAt:time,connectionEpoch:1,physical:'closed',meter:'settled',result:{kind:'decoded',page:{kind:'issue_comments',completeness:'complete',entries:[]}}};
 const read={...comments,attemptId:'read-1',reservationRef:'res-1',plan:planGithubGet({schemaVersion:1,kind:'issue',boundRepository:bound,parentIssue:parent}),responseBytes:200,result:{kind:'decoded',page:{kind:'issue',completeness:'complete',entry:{kind:'value',snapshotId:snapshot.snapshotId}}}};
 const selected={schemaVersion:1,readSetId:'',scanId:'scan',bindingId:'binding',selection:{kind:'issue_ids',issueIds:['42']},issueListAttemptIds:[],parents:[{issueId:'42',parentReadAttemptId:'read-1',parentSnapshotId:snapshot.snapshotId,commentListAttemptIds:['read-2'],selectedSnapshotIds:[snapshot.snapshotId]}],pagination:'complete'};
 selected.readSetId='dsh-read-set:'+githubReadHash('dsh-source-read-set-v1',{...selected,readSetId:null});
 return {schemaVersion:1,scanId:'scan',bindingId:'binding',bindingRevision:1,boundRepository:bound,authScope:{tenantId:'tenant',workspaceId:'workspace',connectionId:'connection',providerAccountId:'12',repositoryId:'123',credentialEpoch:1},sourceBindingVersion:1,actorMappingVersion:1,provenanceVersion:1,selection:selected.selection,startedAt:time,completedAt:time,previousCheckpointRevision:0,reads:[read,comments],snapshots:[snapshot],selected,candidates:[],contentCheckpoint:{schemaVersion:1,bindingId:'binding',expectedRevision:0,scanId:'scan',selectedReadSetId:selected.readSetId,since:null,overlapSeconds:300,lastFullReconcileScanId:'scan'}};
}
function envelopeFor(scan:ReturnType<typeof fixture>) {return {thread:{sourceBindingId:'binding',tenantId:'tenant',workspaceId:'workspace',provider:'github',repositoryId:'123',kind:'issue',threadId:'42'},authScope:scan.authScope,providerEventId:null,objectKind:'issue',objectId:'42',providerRevision:'"rev1"',contentHash:scan.snapshots[0].object.contentHash,receivedAt:time,objectAuthorId:'12',actorEvidence:{kind:'unknown',reason:'snapshot'},actorMappingVersion:1,provenanceVersion:1,actorEvidenceHash:'a'.repeat(64),kind:'snapshot',trust:'external_untrusted',snapshotRef:scan.snapshots[0].snapshotId,completeness:'complete',paginationComplete:true,authorizationCheckedAt:time};}
describe('S2 original A storage data only',()=>{
 it('round trips complete original content and produces five typed row classes',()=>{
  const scan=parseGithubSourceScan(fixture()), rows=planGithubSourceRows(scan,[]);
  expect((rows.snapshots[0].data.object as {body:string}).body).toBe('正文\noriginal');expect(rows.reads).toHaveLength(2);expect(rows.imports).toHaveLength(0);
  expect(DSH_GITHUB_SOURCE_DDL).toContain('dsh_a_source_content_checkpoints');
  const all=[rows.scan,...rows.reads,...rows.snapshots,rows.readSet];
  for(const row of all)expect(readGithubSourceRow(row.table,row)).toEqual(row.data);
  expect(validateGithubSourceRelations(rows).selected.pagination).toBe('complete');
 });
 it.each(['extra','scope','snapshot-id','content','entry','missing-page','bad-link','wrong-parent','unsafe-epoch'] as const)('rejects %s including recomputed hash claims',variant=>{
  const scan=fixture();
  if(variant==='extra')Object.assign(scan,{extra:true});
  if(variant==='scope')scan.authScope.repositoryId='999';
  if(variant==='snapshot-id')scan.snapshots[0].snapshotId='forged';
  if(variant==='content')scan.snapshots[0].object.body='altered';
  if(variant==='entry')(scan.reads[0].result.page as {entry:{snapshotId:string}}).entry.snapshotId='forged';
  if(variant==='missing-page')scan.selected.parents[0].commentListAttemptIds=[];
  if(variant==='bad-link')scan.reads[1].link='<https://evil.test/next>; rel="next"';
  if(variant==='wrong-parent')scan.selected.parents[0].issueId='99';
  if(variant==='unsafe-epoch')scan.authScope.credentialEpoch=Number.MAX_SAFE_INTEGER+1;
  expect(()=>parseGithubSourceScan(scan)).toThrow();
 });
 it('cold relation reads reject changed indexed scope even when JSON and hashes still agree',()=>{
  const rows=planGithubSourceRows(fixture(),[]);const changed={...rows,snapshots:[{...rows.snapshots[0],index:{...rows.snapshots[0].index,binding_id:'other'}}]};
  expect(()=>validateGithubSourceRelations(changed)).toThrow();
 });
 it('a second observed snapshot reuses the original canonical input and immutable snapshotRef',()=>{
  const scan=fixture(), originalSnapshot=scan.snapshots[0].snapshotId;
  const envelope=envelopeFor(scan);
  Object.assign(scan,{candidates:[{currentSnapshotId:originalSnapshot,eventReadAttemptId:null,eventEntryIndex:null,matchContext:null,envelope,comparison:null}]});
  const first=planGithubSourceRows(scan,[]);expect(first.imports).toHaveLength(1);
  const prior={inputId:first.observations[0].inputId,envelope:{...envelope,snapshotRef:'original-immutable'}};
  const repeat=planGithubSourceRows(scan,[prior]);expect(repeat.imports).toHaveLength(0);expect(repeat.observations[0].canonicalSnapshotRef).toBe('original-immutable');expect(repeat.observations[0].observedSnapshotId).toBe(originalSnapshot);
 });
 it.each(['author','revision','thread','time','comparison'] as const)('rejects mismatched candidate %s relationships',variant=>{
  const scan=fixture(),envelope=envelopeFor(scan),candidate={currentSnapshotId:scan.snapshots[0].snapshotId,eventReadAttemptId:null,eventEntryIndex:null,matchContext:null,envelope,comparison:null as unknown};
  if(variant==='author')envelope.objectAuthorId='99';if(variant==='revision')envelope.providerRevision='wrong';if(variant==='thread')envelope.thread.threadId='99';if(variant==='time')envelope.receivedAt='not-time';if(variant==='comparison')candidate.comparison={arbitrary:true};
  Object.assign(scan,{candidates:[candidate]});expect(()=>parseGithubSourceScan(scan)).toThrow();
 });
 it('admits one fully matched creation without requiring global Events history coverage',()=>{
  const scan=fixture(),current=scan.snapshots[0],object={...current.object,representationTag:'"event-page"'};
  const payload={...current,role:'event_payload',readAttemptId:'read-3',object,snapshotId:''};
  payload.snapshotId='dsh-snapshot:'+githubReadHash('dsh-source-snapshot-v1',[payload.bindingId,payload.readAttemptId,0,payload.role,payload.object]);
  const event={eventId:'99',eventType:'IssuesEvent',action:'opened',actorId:'12',repositoryId:'123',repositoryName:'octo/demo',createdAt:time,object};
  const context={schemaVersion:1,boundRepository:bound,parentIssue:parent,selector:scan.selection,window:{effectiveAt:'2026-11-05T00:00:00Z',observationsEndAt:'2026-11-06T01:00:00Z',sourceSnapshotAt:time},currentRepresentationTag:'"rev1"',currentFreshness:'current',pagination:'complete'};
  const matched=matchGithubCreation(event,current.object,context);if(matched.kind!=='matched')throw Error('fixture creation');
  scan.snapshots.push(payload);
  const {object:_object,...eventData}=event;
  scan.reads.push({...scan.reads[1],attemptId:'read-3',reservationRef:'res-3',plan:planGithubGet({schemaVersion:1,kind:'events',boundRepository:bound,page:1}),result:{kind:'decoded',page:{kind:'events',completeness:'complete',entries:[{kind:'value',event:{...eventData,objectSnapshotId:payload.snapshotId}}]}}} as unknown as typeof scan.reads[number]);
  const envelope={...envelopeFor(scan),providerEventId:'99',kind:'created',actorEvidence:{kind:'verified_event',triggerActorId:'12',eventRef:'dsh-github-event:'+githubReadHash('dsh-github-event-ref-v1',['123','99',matched.eventPayloadHash])},actorEvidenceHash:matched.eventPayloadHash};
  Object.assign(scan,{candidates:[{currentSnapshotId:current.snapshotId,eventReadAttemptId:'read-3',eventEntryIndex:0,matchContext:context,envelope,comparison:null}]});
  expect(planGithubSourceRows(scan,[]).imports).toHaveLength(1);
  const currentEnvelope={...envelope,providerOccurredAt:matched.eventCreatedAt,providerTimeEvidenceRef:envelope.actorEvidence.eventRef};Object.assign(scan,{candidates:[{currentSnapshotId:current.snapshotId,eventReadAttemptId:'read-3',eventEntryIndex:0,matchContext:context,envelope:currentEnvelope,comparison:null}]});expect(planGithubSourceRows(scan,[]).imports).toHaveLength(1);
  for(const change of [{providerOccurredAt:'2026-11-06T00:00:01Z'},{providerTimeEvidenceRef:'foreign-evidence'}]){const corrupted=JSON.parse(JSON.stringify(scan));Object.assign(corrupted.candidates[0].envelope,change);expect(()=>parseGithubSourceScan(corrupted)).toThrow();}
  for(const missing of ['providerOccurredAt','providerTimeEvidenceRef']){const corrupted=JSON.parse(JSON.stringify(scan));delete corrupted.candidates[0].envelope[missing];expect(()=>parseGithubSourceScan(corrupted)).toThrow();}
 });
 it('the five new table DDL uses the original A binding graph and SQLite enforces receipt/snapshot relationships',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA foreign_keys=ON');db.exec(DSH_A_DDL);
   const history=DSH_A_AUTHORITY_DDL.split('\n').find(line=>line.startsWith('CREATE TABLE dsh_a_source_binding_revisions('));if(!history)throw Error('original schema');db.exec(history);db.exec(DSH_GITHUB_SOURCE_DDL);
   const rows=planGithubSourceRows(fixture(),[]);
   db.prepare('INSERT INTO dsh_a_source_bindings VALUES(?,?,?,?,?)').run('binding','source',1,'{}',2);
   db.prepare('INSERT INTO dsh_a_source_binding_revisions VALUES(?,?,?,?,?,?)').run('binding',1,'source','{}','a'.repeat(64),2);
   const put=(r:typeof rows.scan)=>{const values={...r.key,...r.index,body_hash:r.hash,data_json:r.json,logical_bytes:r.bytes};const columns=Object.keys(values);db.prepare('INSERT INTO '+r.table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(values));};
   put(rows.scan);expect(()=>put(rows.snapshots[0])).toThrow();for(const r of rows.reads)put(r);for(const r of rows.snapshots)put(r);put(rows.readSet);put(rows.checkpoint!);
   expect(db.prepare('SELECT data_json FROM dsh_a_source_snapshots').get()?.data_json).toBe(rows.snapshots[0].json);
  }finally{db.close();}
 });
 it('stores a full valid typed snapshot larger than the old metadata row limit',()=>{
  const scan=fixture('b'.repeat(40000),'t'.repeat(40000)),rows=planGithubSourceRows(scan,[]);
  expect(rows.snapshots[0].bytes).toBeGreaterThan(65536);expect((validateGithubSourceRelations(rows).snapshots[0].object.body as string).length).toBe(40000);
 });
 it('a label scan cannot omit all returned selected issues and still claim complete',()=>{
  const scan=fixture(),snapshot={...scan.snapshots[0],readAttemptId:'read-3',snapshotId:''};snapshot.snapshotId='dsh-snapshot:'+githubReadHash('dsh-source-snapshot-v1',[snapshot.bindingId,snapshot.readAttemptId,0,snapshot.role,snapshot.object]);scan.snapshots.push(snapshot);
  const issueRead={...scan.reads[0],attemptId:'read-3',reservationRef:'res-3',plan:planGithubGet({schemaVersion:1,kind:'issues',boundRepository:bound,page:1,since:null,labelNames:['bug']}),result:{kind:'decoded',page:{kind:'issues',completeness:'complete',entries:[{kind:'value',snapshotId:snapshot.snapshotId}]}}};
  const labelRead={...scan.reads[1],attemptId:'read-4',reservationRef:'res-4',plan:planGithubGet({schemaVersion:1,kind:'labels',boundRepository:bound,page:1}),result:{kind:'decoded',page:{kind:'labels',completeness:'complete',entries:[{kind:'value',value:{id:'7',nodeId:'L_7',name:'bug'}}]}}};
  scan.reads.push(issueRead as unknown as typeof scan.reads[number],labelRead as unknown as typeof scan.reads[number]);
  const selection={kind:'label_ids',match:'all',labelIds:['7']};Object.assign(scan,{selection});Object.assign(scan.selected,{selection,parents:[],issueListAttemptIds:['read-3']});scan.selected.readSetId='dsh-read-set:'+githubReadHash('dsh-source-read-set-v1',{...scan.selected,readSetId:null});scan.contentCheckpoint.selectedReadSetId=scan.selected.readSetId;
  expect(()=>parseGithubSourceScan(scan)).toThrow();
 });
 it('never invokes raw getters or proxy traps',()=>{
  let calls=0;const raw=fixture();Object.defineProperty(raw,'reads',{get(){calls++;return [];}});
  expect(()=>parseGithubSourceScan(raw)).toThrow();expect(()=>parseGithubSourceScan(new Proxy({}, {ownKeys(){calls++;return [];}}))).toThrow();expect(calls).toBe(0);
 });
 it('rejects cold row mismatched primary key or canonical bytes even with recomputed body hash',()=>{
  const rows=planGithubSourceRows(fixture(),[]), row=rows.snapshots[0];
  expect(()=>readGithubSourceRow(row.table,{...row,key:{snapshot_id:'wrong'}})).toThrow();
  expect(()=>readGithubSourceRow(row.table,{...row,json:row.json+' '})).toThrow();
 });
});
