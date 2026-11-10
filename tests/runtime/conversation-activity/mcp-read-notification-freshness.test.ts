import{expect,it,vi}from'vitest';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{ConversationActivityOwnerHost}from'../../../src/runtime/conversation-activity/owner-host.js';
import{ConversationActivityOwnerClient}from'../../../src/runtime/conversation-activity/owner-client.js';
import{ConversationActivityAttachedService}from'../../../src/runtime/conversation-activity/owner-service.js';
import{ConversationActivityStore}from'../../../src/runtime/conversation-activity/store.js';
import{ActivityOwnerMcp}from'../../../src/runtime/conversation-activity/owner-mcp.js';
import{ActivityNativeIdentityRepository}from'../../../src/runtime/conversation-activity/native-identity.js';
import{ConversationMcpActivities}from'../../../src/runtime/conversation-activity/mcp.js';
import{createMcpClientConnection}from'../../../src/platform/mcp/transport.js';
import{callMcpToolWithTasks}from'../../../src/platform/mcp/tasks.js';

it('serves a real status notification received while an older post-ACK snapshot is still committing, without waiting for the polling timer',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mcp-hint-freshness-')),sessions=join(root,'sessions');mkdirSync(sessions);writeFileSync(join(sessions,'thread.json'),JSON.stringify({schemaVersion:1,sessionId:'thread',cwd:root,intentDelegation:{ownership:{state:'owned',ownerInstanceId:'instance'}},messages:[]}));
 const identity=new ActivityNativeIdentityRepository({kind:'cli',path:sessions,workspaceRoot:root,profileId:'profile',instanceId:'instance'});let ownerMcp!:ActivityOwnerMcp;
 const host=new ConversationActivityOwnerHost({dataRoot:join(root,'activity'),profileId:'profile',actorId:'user',getThread:id=>identity.getThread(id),authorizeProducer:(id,instance)=>identity.authorizeProducer(id,instance),canObserveWork:watch=>ownerMcp.canObserve(watch),mcpRequest:(method,input,id)=>method==='mcpRegister'?ownerMcp.register(input,id):Promise.reject(Error('fixture_method_unavailable')),disconnected:id=>ownerMcp.disconnected(id)});
 ownerMcp=new ActivityOwnerMcp({root:join(root,'activity'),store:host.store,service:host.service,actorId:'user'});await host.start();
 const client=new ConversationActivityOwnerClient(join(root,'activity'),'producer','instance'),service=new ConversationActivityAttachedService(client,'user'),store=new ConversationActivityStore(join(root,'activity','conversation-activity.sqlite'),{readOnly:true});
 const connection=await createMcpClientConnection('fresh-input',{type:'stdio',command:process.execPath,args:[join(process.cwd(),'tests/support/mcp-tasks-stdio-server.js')],env:{XIAOK_TEST_MANUAL_TASK:'1',XIAOK_TEST_TWO_INPUTS:'1',XIAOK_TEST_PROCESS_LOG:join(root,'child.json')},protocol:{mode:'modern',version:'2026-07-28'}});
 const childPid=JSON.parse(readFileSync(join(root,'child.json'),'utf8')).pid as number;console.info(JSON.stringify({fixtureChildPid:childPid,phase:'started'}));
 const errors:unknown[]=[],activities=new ConversationMcpActivities({store,service,actorId:'user',originThread:async()=> 'thread',endpointReady:async connection=>{await client.request('mcpRegister',{endpointId:connection.tasks!.endpointId,name:connection.activityEndpoint!.name});},onError:error=>errors.push(error)});activities.register(connection);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});let working=0,hints=0;const accept=service.acceptEvent.bind(service);
 const held=vi.spyOn(service,'acceptEvent').mockImplementation(async(...args)=>{if(++working===2){entered();await gate;}return accept(...args);});
 const observeHints=connection.observeTaskStatus!.bind(connection);const hintsSpy=vi.spyOn(connection,'observeTaskStatus').mockImplementation((id,callback)=>observeHints(id,()=>{hints++;callback();}));
 try{
  const observer=await activities.observer('task','fresh',connection);await callMcpToolWithTasks(connection,{name:'work',arguments:{ask:true}},{observer,detachOnTask:true,timeout:2000});await ready;
  // Initial read completed. This second real working snapshot began after the
  // actual listen ACK; its original accepted-event write is the sole held seam.
  await connection.client.callTool({name:'fixture-task-input',arguments:{taskId:'task-1'}});await vi.waitFor(()=>expect(hints).toBeGreaterThan(0));release();
  await vi.waitFor(()=>expect(host.store.getProjection('mcp:fresh')?.executionState).toBe('input_required'),{timeout:3000});
  expect(working).toBeGreaterThan(2);const stats=await connection.client.callTool({name:'stats',arguments:{}}),counts=JSON.parse((stats.content[0]as{text:string}).text);expect(counts.calls).toBe(1);expect(counts.gets).toBeGreaterThanOrEqual(3);expect(errors).toEqual([]);
 }finally{
  release();held.mockRestore();hintsSpy.mockRestore();
  const failure:unknown[]=[];for(const close of[()=>activities.close(),()=>connection.close(),async()=>{await vi.waitFor(()=>{let alive=false;try{process.kill(childPid,0);alive=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}expect(alive).toBe(false);});console.info(JSON.stringify({fixtureChildPid:childPid,phase:'closed',remainingFixtureChildren:0}));},()=>service.close(),()=>store.close(),()=>ownerMcp.close(),()=>host.stop(),()=>identity.close()])try{await close();}catch(error){failure.push(error);}client.dispose();rmSync(root,{recursive:true,force:true});if(failure.length)throw new AggregateError(failure,'mcp_freshness_fixture_cleanup_failed');
 }
},15000);
