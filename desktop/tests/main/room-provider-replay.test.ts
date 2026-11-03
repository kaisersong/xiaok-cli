// @vitest-environment node
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { createCollaborationRoomBrokerClient, createRoomAuthorizationContextReader } from '../../electron/collaboration-room-broker-client.js';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';
import { createRoomProjectScopeGuard } from '../../electron/room-project-scope-guard.js';
import { createCollaborationRoomWakeDispatcher } from '../../electron/collaboration-room-wake-dispatcher.js';
import { setRoomHistoryBrokerClient } from '../../electron/room-history-page-tool.js';

it('real dispatcher/provider/history capability replays identical requests across guard modes', async () => {
  const root=mkdtempSync(join(tmpdir(),'room-provider-replay-')),configRoot=join(root,'config');
  mkdirSync(configRoot);
  const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=configRoot;
  const nodeImport=(specifier:string):Promise<any>=>import(/* @vite-ignore */ specifier);
  const helpers=await nodeImport(pathToFileURL(resolve(process.cwd(),'..','scripts/evals/_desktop-runtime/provider-replay.mjs')).href);
  const sibling=resolve(process.cwd(),'..','..','intent-broker');
  const {createBrokerService}=await nodeImport(pathToFileURL(join(sibling,'src/broker/service.js')).href);
  const {createServer:createBrokerServer}=await nodeImport(pathToFileURL(join(sibling,'src/http/server.js')).href);
  const brokerToken='room-replay-private-token',providerToken='private_provider_fixture_key_123456789';
  const dbPath=join(root,'broker.db'),prepared=join(root,'prepared.db');
  let broker:any,brokerServer:any,origin='',replay:any;
  const trace:string[]=[],claimTokens:string[]=[];
  const routedFetch:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(!['http://127.0.0.1:4318','http://localhost:4318'].includes(url.origin))throw Error('unapproved_test_origin');
    trace.push(url.pathname);
    const response=await fetch(origin+url.pathname+url.search,{...init,redirect:'error'}),json=response.json.bind(response);
    response.json=async()=>{const value=await json();if(url.pathname.endsWith('/workspace/claim-wake')&&typeof value.claimToken==='string')claimTokens.push(value.claimToken);return value;};
    return response;
  };
  const raw=()=>createCollaborationRoomBrokerClient({token:brokerToken,fetchImpl:routedFetch});
  async function openBroker(){
    broker=createBrokerService({dbPath});brokerServer=createBrokerServer({broker,roomService:broker.room,roomDesktopToken:brokerToken,roomKSwarmToken:'fixture-kswarm'});
    await brokerServer.listen(0,'127.0.0.1');origin='http://127.0.0.1:'+brokerServer.address().port;
  }
  async function closeBroker(){if(brokerServer){await brokerServer.close();brokerServer=undefined;}if(broker){broker.close();broker=undefined;}}
  const recorded:any[]=[],bodies:any[]=[];
  const emit=(delta:unknown,finish_reason:string|null)=>'data: '+JSON.stringify({id:'fixture-response',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n';
  const responses=[
    [emit({tool_calls:[{index:0,id:'search-call-fixed',type:'function',function:{name:'tool_search',arguments:'{"query":"select:getRoomMessagesPage"}'}}]},null),emit({},'tool_calls'),'data: [DONE]\n\n'],
    [emit({tool_calls:[{index:0,id:'history-call-fixed',type:'function',function:{name:'getRoomMessagesPage',arguments:'{"limit":2}'}}]},null),emit({},'tool_calls'),'data: [DONE]\n\n'],
    [emit({content:'ROOM_REPLAY_DONE'},null),emit({},'stop'),'data: [DONE]\n\n'],
  ];
  const recorder=createServer(async(req,res)=>{
    try{
      let bytes='';for await(const chunk of req)bytes+=chunk;
      const body=JSON.parse(bytes);bodies.push(body);const chunks=responses[recorded.length];
      if(!chunks){res.writeHead(409);res.end('unexpected fixture request');return;}
      recorded.push({requestDigest:helpers.providerRequestDigest(body),chunks});res.writeHead(200,{'content-type':'text/event-stream'});
      for(const chunk of chunks)res.write(chunk);res.end();
    }catch{res.writeHead(400);res.end('fixture request invalid');}
  });
  try{
    await openBroker();const client=raw();
    const created:any=await client.createRoom({title:'Replay fixture',memberAgentIds:['agent']});expect(created.ok).toBe(true);
    const roomId=created.room.roomId;
    await client.sendRoomMessage({roomId,text:'HISTORY_SENTINEL',idempotencyKey:'history',responsePolicy:'none'});
    const sent:any=await client.sendRoomMessage({roomId,text:'Use history before replying',idempotencyKey:'trigger',responsePolicy:'mentioned',mentions:[{kind:'agent',logicalAgentId:'agent'}]});
    expect(sent.ok).toBe(true);await closeBroker();copyFileSync(dbPath,prepared);
    const preparedHash=createHash('sha256').update(readFileSync(prepared)).digest('hex');
    await new Promise<void>(done=>recorder.listen(0,'127.0.0.1',done));const address=recorder.address() as {port:number};
    const configure=(baseUrl:string)=>writeFileSync(join(configRoot,'config.json'),JSON.stringify({
      schemaVersion:2,defaultProvider:'openai',defaultModelId:'fixture',
      providers:{openai:{type:'first_party',protocol:'openai_legacy',apiKey:providerToken,baseUrl:baseUrl+'/v1'}},
      models:{fixture:{provider:'openai',model:'gpt-room-fixture',label:'fixture',runtimeOptions:{contextLimit:100000}}},
      defaultMode:'interactive',contextBudget:100000,channels:{},
    }));
    configure('http://127.0.0.1:'+address.port);
    const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:{request:async()=>{throw Error('unexpected_kswarm_request');},getDesktopMutationToken:()=>'fixture'} as any});
    for(const mode of ['legacy','projection'] as const){
      copyFileSync(prepared,dbPath);expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(preparedHash);
      await openBroker();trace.length=0;
      const roomClient=raw(),workspace=createRoomWorkspaceBrokerClient({token:brokerToken,fetchImpl:routedFetch,isMutationOwner:()=>true});
      const guarded=createRoomProjectScopeGuard({roomClient,workspaceBroker:workspace,authorizationReadMode:mode,
        authorizationContextReader:mode==='projection'?createRoomAuthorizationContextReader({token:brokerToken,origin:'http://127.0.0.1:4318',fetchImpl:routedFetch}):undefined,
        kswarmRequest:async()=>{throw Error('unexpected_kswarm_authorization');}});
      setRoomHistoryBrokerClient(guarded.roomClient);
      const dispatcher=createCollaborationRoomWakeDispatcher({brokerClient:guarded.roomClient,execute:services.runCollaborationRoomAgentTask});
      const result=await dispatcher.dispatchMessage({roomId,roomMessageId:sent.message.messageId,logicalAgentIds:['agent']});
      expect(result).toEqual({ok:true,completed:['agent'],failed:[]});
      if(mode==='legacy'){expect(bodies[0].tools.map((tool:any)=>tool.function.name)).toContain('tool_search');expect(JSON.stringify(bodies[2].messages.filter((message:any)=>message.role==='tool'))).toContain('HISTORY_SENTINEL');}
      expect(trace.filter(path=>path.endsWith('/authorization-context'))).toHaveLength(mode==='projection'?3:0);
      expect(trace.filter(path=>path==='/rooms/'+roomId)).toHaveLength(mode==='projection'?1:4);
      expect(trace.filter(path=>path==='/room-wakes/history-page')).toHaveLength(1);
      const snapshot:any=await roomClient.getRoomSnapshot(roomId);expect(snapshot.messages.filter((message:any)=>message.text==='ROOM_REPLAY_DONE')).toHaveLength(1);
      await closeBroker();setRoomHistoryBrokerClient(null);
      if(mode==='legacy'){
        expect(recorded).toHaveLength(3);expect(bodies[0].tools.some((tool:any)=>tool.function.name==='tool_search')).toBe(true);
        expect(JSON.stringify(bodies[2].messages.filter((message:any)=>message.role==='tool'))).toContain('HISTORY_SENTINEL');
        expect(claimTokens.every(token=>!JSON.stringify(bodies).includes(token))).toBe(true);
        const path=join(root,'provider-fixture.json'),bytes=JSON.stringify({schema:'xiaok-provider-replay/v1',protocol:'openai.chat.completions.sse',technicalFields:[],steps:recorded});
        writeFileSync(path,bytes,{mode:0o600});replay=await helpers.startProviderReplay({fixturePath:path,expectedSha256:createHash('sha256').update(bytes).digest('hex'),token:providerToken});
        configure(replay.origin);
      }else{replay.assertComplete();expect(replay.stats().consumed).toBe(3);expect(replay.stats().failureCount).toBe(0);}
    }
  }finally{
    setRoomHistoryBrokerClient(null);await closeBroker();if(replay)await replay.close();
    recorder.closeAllConnections();await new Promise<void>(done=>recorder.close(()=>done()));
    if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;
  }
},30000);
