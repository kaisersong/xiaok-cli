// @vitest-environment node
import type {KSwarmService} from '../../electron/kswarm-service.js';
import {it,expect,vi} from 'vitest';import {createServer} from 'node:http';import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const root=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
it('budget reader rejects a closed or copied opaque port without dispatch',async()=>{
 const p=await import('../../../src/runtime/task-host/workflow-restriction-checkpoint.ts');const port=p.createNativeWorkflowReadPort();await p.closeNativeWorkflowReadPort(port);
 await expect(p.readNativeWorkflowRun(port,'project','run')).rejects.toThrow('workflow_stored_restrictions_denied');await expect(p.readNativeWorkflowRun({}as never,'project','run')).rejects.toThrow('workflow_stored_restrictions_denied');
});
for(const mode of ['body-drain','request-replaced']as const)it(`actual budget JSON read owns ${mode}`,async()=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null,{issuer:'po_generated',tasks:[{title:'Fictional report',assignedAgent:'xiaok-worker',requiredOutputs:['markdown']}]});
 const previousFetch=globalThis.fetch,previousEntry=process.env.KSWARM_SERVER_PATH;const entered=deferred(),release=deferred(),parseSettling=deferred(),bodyRelease=deferred();let ks:KSwarmService|undefined,reading:Promise<any>|undefined,closing:Promise<void>|undefined,proxy:any;let jsonClosed=false,drained=false,requestCalls=0;let originalRequest:any;
 try{
 process.env.KSWARM_SERVER_PATH=resolve(root,'..','kswarm','src/server/index.js');globalThis.fetch=fixture.forwardedFetch;
 const m=await import('../../electron/kswarm-service.ts');ks=m.createKSwarmService({spawnProcess:(()=>{throw Error('foreign_spawn_denied');})as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('foreign_kill_denied');}});await m.getKSwarmWorkflowReadPort(ks);
 const path='/projects/'+fixture.project.id+'/workflows/'+fixture.issued.workflowRun.id;
 if(mode==='body-drain'){
  proxy=createServer(async(req,res)=>{const native=await fixture.nativeFetch(fixture.base+req.url),bytes=Buffer.from(await native.arrayBuffer());res.on('close',()=>{jsonClosed=true;});res.writeHead(native.status,{'content-type':'application/json'});res.write(bytes.subarray(0,bytes.length-1));await bodyRelease.promise;if(!res.destroyed)res.end(bytes.subarray(bytes.length-1));});
  await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 }
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));const selected=url.pathname===path;
  const response=selected&&mode==='body-drain'?await fixture.nativeFetch('http://127.0.0.1:'+proxy.address().port+path,init):await fixture.forwardedFetch(input,init);
  if(selected){const json=response.json.bind(response);response.json=async()=>{entered.resolve();try{return await json();}finally{parseSettling.resolve();await release.promise;}};}
  return response;
 };
 reading=m.readKSwarmWorkflowRunForExecution(ks,fixture.project.id,fixture.issued.workflowRun.id).then(value=>({ok:true,value}),error=>({ok:false,error}));await entered.promise;
 if(mode==='body-drain'){
  closing=m.sealAndDrainKSwarmServiceInstance(ks);closing.then(()=>{drained=true;});await parseSettling.promise;await delay(20);expect(jsonClosed).toBe(true);expect(drained).toBe(false);release.resolve();await closing;expect(drained).toBe(true);expect((await reading).ok).toBe(false);
 }else{
  await parseSettling.promise;originalRequest=ks.request;ks.request=(async()=>{requestCalls++;throw Error('counterfeit_request');})as never;release.resolve();const result=await reading;expect(result.ok).toBe(false);expect(String(result.error)).toContain('kswarm_workflow_read_instance_changed');expect(requestCalls).toBe(0);ks.request=originalRequest;
 }
 }finally{
 release.resolve();bodyRelease.resolve();if(ks&&originalRequest)ks.request=originalRequest;await reading;await closing;
 if(ks){const m=await import('../../electron/kswarm-service.ts');await m.sealAndDrainKSwarmServiceInstance(ks);}if(proxy){proxy.closeAllConnections();await new Promise<void>(r=>proxy.close(r));}
 globalThis.fetch=previousFetch;if(previousEntry===undefined)delete process.env.KSWARM_SERVER_PATH;else process.env.KSWARM_SERVER_PATH=previousEntry;await fixture.close();
 }
},8000);
it('a counterfeit service cannot route its own approved budget response',async()=>{
 const m=await import('../../electron/kswarm-service.ts');let calls=0;const counterfeit={request:async()=>{calls++;return new Response(JSON.stringify({workflowRun:{approval:{status:'approved'}}}));}};
 await expect(m.readKSwarmWorkflowRunForExecution(counterfeit as never,'project','run')).rejects.toThrow('kswarm_workflow_read_instance_unknown');expect(calls).toBe(0);
});
