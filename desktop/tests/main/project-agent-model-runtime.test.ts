// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';

describe('project selected model through real Desktop runtime and HTTP provider',()=>{
 it('keeps a completed tool result when the pinned model fails, then uses current model',async()=>{
  const root=mkdtempSync(join(tmpdir(),'project-model-runtime-'));const configDir=join(root,'config');mkdirSync(configDir);
  const old=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=configDir;
  const requests:any[]=[];let selectedCalls=0;
  const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
    if(body.model==='selected'&&++selectedCalls===2){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'model was removed'}}));return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const delta=body.model==='selected'?{tool_calls:[{index:0,id:'write-once',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:join(root,'result.txt'),content:'once'})}}]}:{content:JSON.stringify({summary:'done',artifacts:[]})};
    res.write(`data: ${JSON.stringify({id:'m',choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({id:'m',choices:[{index:0,delta:{},finish_reason:body.model==='selected'?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  writeFileSync(join(configDir,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'local',defaultModelId:'current',providers:{local:{type:'custom',protocol:'openai_legacy',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,apiKey:'fixture'}},models:{selected:{provider:'local',model:'selected',label:'Selected',capabilities:['tools','image_in']},current:{provider:'local',model:'current',label:'Current',capabilities:['tools']}},defaultMode:'interactive',channels:{}}));
  const gateway={request:vi.fn(async()=>new Response(JSON.stringify({agents:[{id:'worker',runtimeType:'xiaok',desktopModelId:'selected'}]}))),getDesktopMutationToken:()=> 'fixture'};
  const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:gateway as any});
  try{
    const result=await services.runKSwarmHandoffTask({targetParticipantId:'worker',handoff:{kind:'kswarm_task_handoff_v1',runId:'r',project:{id:'p',name:'Project',goal:'Test',workFolder:root},task:{id:'t',title:'Write once',requiredOutputs:[]}}});
    expect(result.summary).toContain('done');expect(requests.map(r=>r.model)).toEqual(['selected','selected','current']);
    expect(requests[2].messages.some((m:any)=>m.role==='tool'&&m.tool_call_id==='write-once')).toBe(true);
    expect(readFileSync(join(root,'result.txt'),'utf8')).toBe('once');
  }finally{await services.disposeMultiAgent();await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=old;rmSync(root,{recursive:true,force:true});}
 },20000);
 it('preserves references and explicit follow-current through real KSwarm store reopen',async()=>{
  const root=mkdtempSync(join(tmpdir(),'project-model-store-'));
  try {
    const nativeImport=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;
    const {createAgentStore}=await nativeImport(pathToFileURL(resolve(process.cwd(),'../../kswarm/src/core/agent-store.js')).href);
    const filePath=join(root,'agents.json');const first=createAgentStore({filePath});
    const created=first.create({name:'Vision worker',runtimeType:'xiaok',runtimeSource:'desktop-agent-runtime',desktopModelId:'vision'});
    expect(created.ok).toBe(true);expect(createAgentStore({filePath}).get(created.agent.id).desktopModelId).toBe('vision');
    first.update(created.agent.id,{desktopModelId:null});expect(createAgentStore({filePath}).get(created.agent.id).desktopModelId).toBeNull();
  } finally {rmSync(root,{recursive:true,force:true});}
 });

});
