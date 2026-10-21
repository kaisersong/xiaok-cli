import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {runPairedDesktopTask} from '../../scripts/evals/sol-pi/paired-desktop.mjs';
for(const candidate of [false,true])test(`v9 ${candidate?'candidate':'legacy'} production task host and runner using exact native schema`,{timeout:120000},async()=>{
 const sourceRoot=resolve(candidate?'.':'.eval-runs/sol-pi-baseline-20260918-r19/snapshot');
 const load=file=>import(pathToFileURL(join(sourceRoot,file)).href);
 const [{ToolRegistry},{createReadTool},{bashTool}]=await Promise.all([load('src/ai/tools/index.ts'),load('src/ai/tools/read.ts'),load('src/ai/tools/bash.ts')]);
 const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'paired-v9-main-'))), workspace=join(root,'workspace');await fs.mkdir(workspace);
 const priorFetch=globalThis.fetch,priorCwd=process.cwd();process.chdir(workspace);
 const marker='V9_NATIVE_ARCHIVED_MIDDLE',content='head '.repeat(1500)+marker+'tail '.repeat(1500),file=join(workspace,'fixture.txt');await fs.writeFile(file,content);
 const command='printf V9_APPROVED',registry=new ToolRegistry({autoMode:true},[createReadTool({cwd:workspace}),bashTool]),bodies=[];let reply='';
 globalThis.fetch=async(_url,init)=>{
  const body=String(init.body);bodies.push(body);const n=bodies.length;
  const names=JSON.parse(body).tools.map(t=>t.function.name).sort();assert.deepEqual(names,candidate?['bash','observation_read','read']:['bash','read']);
  const invocation=n===1?{name:'read',arguments:JSON.stringify({file_path:file,max_chars:80})}:n<=3?{name:'bash',arguments:JSON.stringify({command,workdir:'.'})}:undefined;
  const delta=invocation?{tool_calls:[{index:0,id:'native-'+n,type:'function',function:invocation}]}:{content:'V9_DONE'};
  return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:invocation?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 try{
  const config={schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'private-fixture'}},models:{current:{provider:'deepseek',model:'deepseek-flash',label:'Current'}},defaultMode:'interactive'};
  const result=await runPairedDesktopTask({sourceRoot,runDirectory:root,workspace,task:{files:{'fixture.txt':content}},command,config,registry,prompt:'Read fixture, run exact command twice, then answer.',signal:new AbortController().signal,deadline:Date.now()+90000,candidate,onRuntimeEvent:event=>{if(event.type==='assistant_delta')reply+=event.delta;}});
  assert.equal(result.taskStatus,'completed');assert.equal(result.durableTask,true);assert.equal(bodies.length,4);assert.equal(result.wireAttempts,4);assert.equal(result.adapterStreamCalls,4);assert.equal(result.registryReturned,3);assert.match(result.firstAdapterPromptSha256,/^[a-f0-9]{64}$/);assert.deepEqual(result.wireModels,['deepseek-flash']);assert.match(result.firstWireBodySha256,/^[a-f0-9]{64}$/);assert.match(reply,/V9_DONE/);
  if(candidate){assert.equal(result.qualified,true);assert.equal(result.durableSidecar,true);assert.match(bodies[1],new RegExp(marker));assert.match(bodies[2],new RegExp(marker));assert.doesNotMatch(bodies[3],new RegExp(marker));assert.equal(result.projection.referenceObservationViews,1);assert.equal(result.counters[0].fullLogicalSendCount,2);}
  else{assert.equal(result.qualified,false);assert.equal(result.durableSidecar,false);assert.doesNotMatch(bodies[1],new RegExp(marker));}
 }finally{globalThis.fetch=priorFetch;process.chdir(priorCwd);registry.dispose();await fs.rm(root,{recursive:true,force:true});}
});
