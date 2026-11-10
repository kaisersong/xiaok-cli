import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {parseProjectActivityPage} from '../../../src/runtime/conversation-activity/project-delivery-data.js';

// The fixture invokes the original sibling Hub, task board, file candidate and
// SQLite owner. It does not reconstruct a delivery head or its hashing rules.
const producer = String.raw`
 const {createHub}=await import(process.argv[1]);
 const {join}=await import('node:path');const fs=await import('node:fs');
 const root=process.argv[2],file=join(root,'report.md');fs.writeFileSync(file,'# Original candidate\nActual original file.');
 const hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')}});
 try{
  hub.createProject({id:'p',name:'Original project',goal:'Read the actual delivery',poAgent:'po',members:['worker'],autoAssignPo:false});
  const created=hub.handleCreateTasks('p',[{id:'item-1',title:'Write',assignedAgent:'worker',dependencies:[]}],'po');hub.handleApprove('p');
  const board=hub.getBoard('p'),task=board.getTask(created.taskIds[0]);
  board.transition(task.id,'dispatched',{assignedAgent:'worker',runId:'r1'});board.transition(task.id,'accepted',{assignedAgent:'worker'});board.transition(task.id,'in_progress');
  for(const result of [hub.handleSubmitResult('p',task.id,{summary:'Done',workFolder:root,artifacts:[{artifactId:'report',path:file}]},'worker','r1'),hub.handleQualityReview('p',task.id,{passed:true,feedback:'Reviewed'},'po'),hub.handleDeliver('p',{summary:'Review this',artifactRef:{path:file,artifactId:'report'}},'po',{taskId:task.id,workFolder:root,expectedFormat:'markdown'})])if(!result.ok)throw Error(JSON.stringify(result));
  const first=hub.getProjectActivity('p');hub.mutateProjectState('p',()=>{hub.getProject('p').planRevisionRequired={taskId:task.id};});
  const middle=hub.getProjectActivity('p',{after:first.headSeq});hub.mutateProjectState('p',()=>{delete hub.getProject('p').planRevisionRequired;});
  const again=hub.getProjectActivity('p',{after:first.headSeq});hub.createProject({id:'q',name:'Foreign project',goal:'Independent',poAgent:'po',members:[],autoAssignPo:false});
  const foreign=hub.getProjectActivity('q'),clock=Date.now;let now=clock();
  try{Date.now=()=>now;for(let index=0;index<300;index++){now+=1001;hub.invalidateTeamPlansForAgent('worker');}}finally{Date.now=clock;}
  const retained=[];let after=0;
  for(let index=0;index<32;index++){const page=hub.getProjectActivity('p',{after,limit:200});retained.push(page);if(page.nextCursor===page.headSeq)break;if(page.nextCursor<=after)throw Error('Fixture source cursor stalled');after=page.nextCursor;}
  fs.writeFileSync(join(root,'pages.json'),JSON.stringify({first,middle,again,foreign,retained}));
 }finally{hub.closePersistence();}
`;
type Page=Record<string,unknown> & {sourceDataEpoch:string;headSeq:number;delivery:{status:string;head:Record<string,unknown>}};
let root:string,pages:{first:Page;middle:Page;again:Page;foreign:Page;retained:Page[]};
const expected=()=>({projectId:'p',sourceDataEpoch:pages.first.sourceDataEpoch,after:0});
beforeAll(()=>{
  root=mkdtempSync(join(tmpdir(),'activity-original-project-page-'));
  const child=spawnSync(process.execPath,['--input-type=module','-e',producer,pathToFileURL(resolve('..','kswarm','src','core','hub.js')).href,root],{encoding:'utf8',timeout:10000});
  console.log(JSON.stringify({test:'original-project-page-producer',pid:child.pid,status:child.status,signal:child.signal,reaped:true}));
  if(child.error)throw child.error;if(child.status!==0)throw Error(child.stderr||child.stdout);
  pages=JSON.parse(readFileSync(join(root,'pages.json'),'utf8'));
});
afterAll(()=>{if(root)rmSync(root,{recursive:true,force:true});});
describe('original B project activity transport data',()=>{
  it('captures its expected audience before either outer or nested getters can reach type validation',()=>{
    let calls=0;const outer=expected();Object.defineProperty(outer,'projectId',{enumerable:true,get(){calls++;return'p';}});
    expect(()=>parseProjectActivityPage(pages.first,outer)).toThrow();expect(calls).toBe(0);
    const nested={...expected(),projectId:{get then(){calls++;return undefined;}}};
    expect(()=>parseProjectActivityPage(pages.first,nested as unknown as ReturnType<typeof expected>)).toThrow();expect(calls).toBe(0);
  });
  it('accepts original committed candidate data and independent empty-page ABA without manufacturing execution',()=>{
    const first=parseProjectActivityPage(pages.first,expected());expect(first.delivery.status).toBe('current');
    if(first.delivery.status!=='current')throw Error('Actual producer delivery unavailable');
    expect(first.delivery.head.core.stage).toBe('ready_for_acceptance');expect(first.snapshot.status).toBe('active');
    const middle=parseProjectActivityPage(pages.middle,{...expected(),after:pages.first.headSeq});
    const again=parseProjectActivityPage(pages.again,{...expected(),after:pages.first.headSeq});
    expect(middle.events).toEqual([]);expect(again.events).toEqual([]);expect(again.headSeq).toBe(first.headSeq);
    if(middle.delivery.status!=='current'||again.delivery.status!=='current')throw Error('Actual ABA producer delivery unavailable');
    expect(middle.delivery.head.core.stage).toBe('none');expect(again.delivery.head.core.stage).toBe('ready_for_acceptance');expect(again.delivery.head.deliveryRevision).toBe(first.delivery.head.deliveryRevision+2);expect(again.delivery.head.factId).not.toBe(first.delivery.head.factId);
  });
  it('does not accept another actual project head even when its own hashes are self-consistent',()=>{
    const raw=structuredClone(pages.first);raw.delivery=structuredClone(pages.foreign.delivery);
    expect(parseProjectActivityPage(raw,expected()).delivery.status).toBe('unavailable');
  });
  it.each(['missing','null','false','zero','empty','future','digest','extra'])('keeps %s delivery unavailable while retaining valid original activity data',kind=>{
    const raw=structuredClone(pages.first);
    if(kind==='missing')delete raw.delivery;
    else if(kind==='future')raw.delivery.head.schemaVersion=99;
    else if(kind==='digest')raw.delivery.head.recordDigest='0'.repeat(64);
    else if(kind==='extra')raw.delivery.head.unrecognizedPermission=true;
    else raw.delivery={status:'current',head:({null:null,false:false,zero:0,empty:''}as Record<string,unknown>)[kind]}as Page['delivery'];
    const result=parseProjectActivityPage(raw,expected());expect(result.delivery.status).toBe('unavailable');expect(result.events).toEqual(pages.first.events);
  });
  it('accepts explicit original unknown delivery without inventing a B version',()=>{
    const raw=structuredClone(pages.first);raw.delivery={status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'}as unknown as Page['delivery'];
    expect(parseProjectActivityPage(raw,expected()).delivery).toEqual(raw.delivery);
  });
  it('refuses a projection-only queued state in the original event kind field',()=>{
    const raw=structuredClone(pages.first);(raw.events as Array<Record<string,unknown>>)[0]!.kind='queued';
    expect(()=>parseProjectActivityPage(raw,expected())).toThrow(/activity_project_page_invalid/);
  });
  it.each(['epoch','project','cursor','covered','event','unknown'])('rejects a conflicting %s page before any coverage is certified',kind=>{
    const raw=structuredClone(pages.first);
    if(kind==='epoch')raw.sourceDataEpoch=pages.foreign.sourceDataEpoch;
    if(kind==='project')(raw.snapshot as Record<string,unknown>).id='q';
    if(kind==='cursor')raw.nextCursor=raw.headSeq+1;
    if(kind==='covered')raw.coveredThrough=-1;
    if(kind==='event')(raw.events as Array<Record<string,unknown>>)[0].workId='q';
    if(kind==='unknown')raw.unrecognizedRootControl=true;
    expect(()=>parseProjectActivityPage(raw,expected())).toThrow(/activity_project_page_invalid/);
  });
  it('rejects getters and oversized input without executing accessors or treating absence as completion',()=>{
    const raw=structuredClone(pages.first);let calls=0;
    Object.defineProperty(raw.delivery.head,'payload',{enumerable:true,get(){calls++;return 'Never call';}});
    expect(()=>parseProjectActivityPage(raw,expected())).toThrow(/activity_project_page_invalid/);expect(calls).toBe(0);
    const large=structuredClone(pages.first);large.snapshot={...(large.snapshot as object),name:'x'.repeat(2*1024*1024+1)};
    expect(()=>parseProjectActivityPage(large,expected())).toThrow(/activity_project_page_invalid/);
  });
  it('enforces the complete encoded UTF-8 budget even when JSON escaping expands individually bounded fields',()=>{
    const raw=structuredClone(pages.first);const snapshot=raw.snapshot as Record<string,unknown>;
    snapshot.tasks=Array.from({length:10000},(_,index)=>({id:String(index)+'\0'.repeat(60),status:'done',attempt:1}));
    expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(2*1024*1024);
    expect(()=>parseProjectActivityPage(raw,expected())).toThrow(/activity_project_page_invalid/);
  });
  it('does not certify a ready head against a snapshot carrying a delivery timestamp',()=>{
    const raw=structuredClone(pages.first);(raw.snapshot as Record<string,unknown>).deliveredAt=1;
    expect(parseProjectActivityPage(raw,expected()).delivery.status).toBe('unavailable');
  });
  it('rejects an event older than the page declared retained source boundary',()=>{
    const raw=structuredClone(pages.first);raw.retainedFromSeq=2;raw.gap=true;
    expect(()=>parseProjectActivityPage(raw,expected())).toThrow(/activity_project_page_invalid/);
  });
  it('accepts actual original compaction gaps over multiple pages without assuming a missing range is a completion',()=>{
    expect(pages.retained.length).toBeGreaterThan(1);expect(pages.retained.some(page=>page.gap===true)).toBe(true);
    let after=0;for(const raw of pages.retained){const page=parseProjectActivityPage(raw,{...expected(),after});expect(page.nextCursor).toBeGreaterThan(after);after=page.nextCursor;}
    expect(after).toBe(pages.retained.at(-1)?.headSeq);
  });
});
