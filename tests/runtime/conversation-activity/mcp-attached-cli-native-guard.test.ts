import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {CliConversationActivities} from '../../../src/runtime/conversation-activity/cli.js';
import {ACTIVITY_STORAGE_NAMES} from '../../../src/runtime/conversation-activity/storage-permissions.js';
import type {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import type {PlatformRuntimeContext} from '../../../src/platform/runtime/context.js';

// The attached RPC is scripted. Original readonly SQLite, actual CLI constructor,
// MCP user entry and bounded native session identity reader are production code.
describe('attached CLI MCP native identity fence',()=>{
 for(const change of ['none','removed','workspace','missing-path'] as const)it(`checks the actual native session file: ${change}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'mcp-attached-native-')),dataRoot=join(root,'activity'),identityPath=join(root,'sessions');mkdirSync(identityPath);
  const identityFile=join(identityPath,'session.json'),write=(cwd:string)=>writeFileSync(identityFile,JSON.stringify({schemaVersion:1,sessionId:'session',cwd,intentDelegation:{ownership:{state:'owned',ownerInstanceId:'instance'}},messages:[]}));write(root);
  const profileId='cli:'+createHash('sha256').update(dataRoot).digest('hex').slice(0,24),store=new ConversationActivityStore(join(dataRoot,ACTIVITY_STORAGE_NAMES.database));
  store.prepareAssociation({operationId:'op',creationIdempotencyKey:'create',origin:{profileId,workspaceId:root,threadId:'session',actorId:'cli-user'}});
  store.bindWork({operationId:'op',watchId:'watch',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'epoch',workId:'task'},
   {endpointId:'endpoint',generation:'v2',taskId:'task',originalOperation:'tools/call'});
  const view={watch:store.getWatch('watch')!,projection:store.getProjection('watch')!};store.close();
  const cancel=vi.fn(async()=>{}),raw={taskId:'task',status:'working',lastUpdatedAt:'2026-11-03T00:00:00Z'};
  const connection={client:{},activityEndpoint:{config:{type:'http'}},tasks:{endpointId:'endpoint',capabilities:{execution:false},cancelTask:cancel,task:()=>({snapshot:async()=>({...raw,raw,extensions:{}})})}};
  const client={onDisconnect:()=>()=>{},subscribe:async()=>()=>{},dispose:()=>{},request:vi.fn(async(method:string)=>method==='work'?view:method==='canReadSource'?true:method==='list'?[]:undefined)} as unknown as ConversationActivityOwnerClient;
  const platform={setMcpActivityHooks:(hooks:any)=>hooks.connected(connection)} as PlatformRuntimeContext;
  const owner=new CliConversationActivities({cwd:root,sessionId:'session',platform,changed:()=>{},ownerClient:client,dataRoot,...(change==='missing-path'?{}:{identityPath})});
  try{
   if(change==='removed')rmSync(identityFile);if(change==='workspace')write(join(root,'other'));
   const result=owner.mcp.cancel('watch',{requestSource:'user',actorId:'cli-user'});
   if(change==='none'){await expect(result).resolves.toEqual({requested:true});expect(cancel).toHaveBeenCalledOnce();}
   else{await expect(result).rejects.toThrow(/activity_thread_forbidden|activity_native_identity_unavailable/);expect(cancel).not.toHaveBeenCalled();}
  }finally{await owner.mcp.close();owner.dispose();rmSync(root,{recursive:true,force:true});}
 });
});
