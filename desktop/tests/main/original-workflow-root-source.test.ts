// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import * as jobs from '../../electron/kswarm-dynamic-workflow-script-tool.js';
import {createKSwarmScriptWorkflowRun} from '../../electron/workflow-script-kswarm-controller.js';
import {createWorkflowScriptPreview,normalizeWorkflowScript,hashWorkflowScript} from '../../electron/workflow-script-contract.js';
import * as source from '../../electron/original-workflow-root-source.js';
import {createKSwarmWorkflowScriptController} from '../../electron/workflow-script-kswarm-controller.js';
import {runWithOriginalRootExecutionContext} from '../../../src/runtime/verification/original-root-execution-context.js';
import {readOriginalKSwarmWorkflowControllerIO} from '../../electron/kswarm-service.js';
it('does not accept a public controller, job DTO, copied service or getter as an accepted workflow root',()=>{
 let calls=0;const fake=new Proxy({}, {get(){calls++;throw Error('foreign getter');},getOwnPropertyDescriptor(){calls++;throw Error('foreign descriptor');}});
 expect(()=>source.readOriginalWorkflowRootSourceBinding(fake)).toThrow();
 expect(()=>source.readOriginalWorkflowScriptRoot(fake,{})).toThrow();
 const controller=createKSwarmWorkflowScriptController({kswarmService:{} as never,projectId:'p',workflowRunId:'r',beforeEffects(){calls++;}});
 expect(()=>source.captureOriginalWorkflowScriptRoot({} as never,controller)).toThrow();
 expect(()=>source.readOriginalWorkflowScriptRoot({} as never,{workflowId:'w',rootJobId:'wf-script-job-r',runId:'r',scriptHash:'a'.repeat(64),known:true})).toThrow();expect(calls).toBe(0);
});

it('confirms the original pre-VM candidate with fixed IO and a bounded real B response while public read methods are replaced',async()=>{
 const owned=await openOwnedWorkflowNormalCase({originalServiceChild:true,project:{id:'root-current',name:'Original metadata current',goal:'Observe only'},workflowName:'root_fixture',phaseTitle:'Observe',prompt:'Observe',label:'Observe'}),service=owned.kswarmService;
 const script=normalizeWorkflowScript("export const meta={name:'current_root',description:'Original root',phases:[{title:'Observe'}]}\nreturn await agent('Observe')"),preview=createWorkflowScriptPreview(script,{projectId:'root-current',requestedBy:'human'}),scriptHash=hashWorkflowScript(script);
 try{await service.start();const ack=await createKSwarmScriptWorkflowRun({kswarmService:service,projectId:'root-current',preview,scriptSource:script,scriptHash});vi.useFakeTimers({toFake:['setTimeout']});const created=(jobs as unknown as {__reserveOriginalScriptJob(input:unknown):{entry:{admission:Promise<unknown>;controller:object}}}).__reserveOriginalScriptJob({kswarmService:service,projectId:'root-current',workflowRunId:String(ack.workflowRun.id),workflowId:'current_root',scriptHash,script,assignedAgent:'xiaok-worker',reuseCompletedPrimitives:false});await created.entry.admission;
 const proof=source.captureOriginalWorkflowScriptRoot(service,created.entry.controller),view=source.readOriginalWorkflowScriptRoot(service,proof);let publicReads=0;service.readProjectExecutionStart=async()=>{publicReads++;throw Error('public read replaced');};service.assertProjectExecutionStartRead=()=>{publicReads++;throw Error('public assertion replaced');};service.request=async()=>{publicReads++;throw Error('public request replaced');};
 const originalIo=readOriginalKSwarmWorkflowControllerIO(service,'root-current',String(ack.workflowRun.id)),detail=await originalIo.perform({kind:'read_run'});expect(detail.ok).toBe(true);expect((detail.body as {workflowRun:{id:string}}).workflowRun.id).toBe(ack.workflowRun.id);await originalIo.waitPhysicalKnown();originalIo.assertPhysicalKnown();let ioGetters=0;await expect(originalIo.perform({kind:'read_run',get path(){ioGetters++;return '/foreign';}} as never)).rejects.toThrow();expect(ioGetters).toBe(0);expect(publicReads).toBe(0);
 const originalFetch=globalThis.fetch;let releaseBody!:()=>void,bodyReady!:()=>void;const ready=new Promise<void>(yes=>{bodyReady=yes;});
 globalThis.fetch=async(input,init)=>{const response=await originalFetch(input,init),url=new URL(String(input));if(url.pathname===`/projects/root-current/workflows/${String(ack.workflowRun.id)}`){const bytes=new Uint8Array(await response.arrayBuffer());return new Response(new ReadableStream({start(controller){releaseBody=()=>{controller.enqueue(bytes);controller.close();};bodyReady();}}),{status:response.status,headers:response.headers});}return response;};
 let validationDone=false,knownDone=false;const validation=source.revalidateOriginalWorkflowScriptRoot(service,proof);void validation.then(()=>{validationDone=true;},()=>{validationDone=true;});await ready;const known=source.readOriginalWorkflowScriptRootSettlement(service,proof).waitKnown();void known.then(()=>{knownDone=true;},()=>{knownDone=true;});await new Promise<void>(yes=>setImmediate(yes));expect(validationDone).toBe(false);expect(knownDone).toBe(false);releaseBody();await validation;await known;globalThis.fetch=originalFetch;view.assertCurrent();view.assertLocal();expect(publicReads).toBe(0);expect(()=>source.readOriginalWorkflowScriptRootSettlement(service,proof).assertKnown()).toThrow('WORKFLOW_ROOT_STILL_ACTIVE');
 jobs.sealKSwarmWorkflowScriptJobs(service);vi.useRealTimers();await jobs.sealAndDrainKSwarmWorkflowScriptJobs(service);expect(()=>view.assertLocal()).toThrow();
 }finally{vi.useRealTimers();await jobs.sealAndDrainKSwarmWorkflowScriptJobs(service);await owned.close();}
});

it('reads only the actual original accepted job/controller and cannot turn an external server into a Native child grant',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'root-p',name:'Original workflow root',goal:'Observe only'},workflowName:'root_fixture',phaseTitle:'Observe',prompt:'Observe',label:'Observe'}),service=owned.kswarmService;
 const script=normalizeWorkflowScript("export const meta={name:'actual_root',description:'Original root',phases:[{title:'Observe'}]}\nreturn await agent('Observe')"),preview=createWorkflowScriptPreview(script,{projectId:'root-p',requestedBy:'human'}),scriptHash=hashWorkflowScript(script);
 try{const ack=await createKSwarmScriptWorkflowRun({kswarmService:service,projectId:'root-p',preview,scriptSource:script,scriptHash});const created=(jobs as unknown as {__reserveOriginalScriptJob(input:unknown):{entry:{admission:Promise<unknown>;controller:object;job:{id:string}}}}).__reserveOriginalScriptJob({kswarmService:service,projectId:'root-p',workflowRunId:String(ack.workflowRun.id),workflowId:'actual_root',scriptHash,script,assignedAgent:'xiaok-worker',reuseCompletedPrimitives:false});await created.entry.admission;
 const proof=source.captureOriginalWorkflowScriptRoot(service,created.entry.controller),view=source.readOriginalWorkflowScriptRoot(service,proof);expect(view).toMatchObject({workflowId:'actual_root',runId:ack.workflowRun.id,rootJobId:created.entry.job.id,projectId:'root-p',scriptHash,priorityClass:'background'});expect(JSON.parse(view.payloadCanonical)).toMatchObject({scriptHash,rootJobId:created.entry.job.id});
 expect(()=>source.readOriginalWorkflowScriptRoot({...service},proof)).toThrow();expect(()=>source.readOriginalWorkflowScriptRoot(service,{})).toThrow();expect(()=>source.captureOriginalWorkflowScriptRoot(service,createKSwarmWorkflowScriptController({kswarmService:service,projectId:'root-p',workflowRunId:String(ack.workflowRun.id)}))).toThrow();
 // This real B fixture is adopted externally, with no original service child.
 // Original metadata acceptance does not manufacture Native Root qualification.
 expect(()=>view.assertCurrent()).toThrow(/NOT_CURRENT/);jobs.sealKSwarmWorkflowScriptJobs(service);await jobs.sealAndDrainKSwarmWorkflowScriptJobs(service);expect(()=>source.readOriginalWorkflowScriptRootSettlement(service,proof).assertKnown()).toThrow('WORKFLOW_ROOT_PHYSICAL_FATE_UNCONFIRMED');
 }finally{await jobs.sealAndDrainKSwarmWorkflowScriptJobs(service);await owned.close();}
});

it('does not downgrade a carried protected root to the ordinary VM path when its service has no original workflow binding',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'root-unbound',name:'Unbound protected root',goal:'Observe only'},workflowName:'root_fixture',phaseTitle:'Observe',prompt:'Observe',label:'Observe'}),service=owned.kswarmService;
 const script=normalizeWorkflowScript("export const meta={name:'unbound_root',description:'Original root',phases:[{title:'Observe'}]}\nreturn await agent('Observe')"),preview=createWorkflowScriptPreview(script,{projectId:'root-unbound',requestedBy:'human'}),scriptHash=hashWorkflowScript(script);
 try{const ack=await createKSwarmScriptWorkflowRun({kswarmService:service,projectId:'root-unbound',preview,scriptSource:script,scriptHash});vi.useFakeTimers({toFake:['setTimeout']});const created=runWithOriginalRootExecutionContext({},()=>(jobs as unknown as {__reserveOriginalScriptJob(input:unknown):{entry:{admission:Promise<unknown>}}}).__reserveOriginalScriptJob({kswarmService:service,projectId:'root-unbound',workflowRunId:String(ack.workflowRun.id),workflowId:'unbound_root',scriptHash,script,assignedAgent:'xiaok-worker',reuseCompletedPrimitives:false}));await expect(created.entry.admission).rejects.toThrow('ROOT_RESOURCE_WORKFLOW_COMPOSITION_REQUIRED');
 }finally{jobs.sealKSwarmWorkflowScriptJobs(service);vi.useRealTimers();await jobs.sealAndDrainKSwarmWorkflowScriptJobs(service);await owned.close();}
});
