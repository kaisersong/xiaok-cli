import {it,expect,vi} from 'vitest';
import {mkdtempSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRoomWorkspaceProjectAdapter} from '../../electron/room-workspace-project-adapter.js';
import {workspaceDigest} from '../../electron/room-workspace-local.js';

it('recovers a signed ticket after lost ACK and cancellation without minting a new grant or reauthorizing',async()=>{
  const records=new Map<string,any>();
  const context:any={roomId:'r',workspaceId:'w',originHostId:'h',bindingId:'b',generation:1,logicalAgentId:'a',claimId:'c',runId:'run',taskId:'p__t',contextScope:{kind:'project',projectId:'p'}};
  const result={summary:'durably authorized'};
  const payloadDigest=workspaceDigest('project-result',{projectId:'p',taskId:'p__t',claimId:'c',runId:'run',result});
  const key=workspaceDigest('project-result-key',{projectId:'p',claimId:'c'});
  records.set(key,{context,taskId:'p__t',submissionId:'run',payloadDigest,result});
  // A second stale item must not prevent the independent historical receipt.
  records.set(workspaceDigest('project-result-key',{projectId:'p',claimId:'missing'}),{context:{...context,claimId:'missing'},taskId:'p__t',submissionId:'run',payloadDigest,result});
  const broker={request:vi.fn(async(_room,action,input)=>{
    expect(action).toBe('recover-ticket');
    if(input.claimId==='missing')return {ok:false,code:'workspace_ticket_mismatch'};
    return {ok:true,ticket:{ticketId:'ticket',payloadDigest,submissionId:'run',roomId:'r',bindingId:'b',generation:1,contextScope:context.contextScope,subject:{claimId:'c'}}};
  })};
  const request=vi.fn(async(path,init)=>{
    expect(path).toBe('/projects/p/workspace-result');expect(JSON.parse(init.body)).toMatchObject({ticketId:'ticket',payloadDigest,result});
    return new Response(JSON.stringify({ok:true}));
  });
  const adapter=createRoomWorkspaceProjectAdapter({broker,kswarmRequest:request,journal:{getRecord:(_kind,key)=>records.get(key),saveRecord:(_kind,key,value)=>records.set(key,structuredClone(value)),listRecords:()=>[...records.values()]}});
  await adapter.retryPending();expect(request).toHaveBeenCalledOnce();expect(records.get(key).applied).toBe(true);
  expect(broker.request.mock.calls.every(call=>call[1]==='recover-ticket')).toBe(true);
});

it('project mapping is read afresh and never admits a changed generation or missing member',async()=>{
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),'project-adapter-')));
  const mapping={projectId:'p',roomId:'r',workspaceId:'w',originHostId:'h',bindingId:'b',generation:1,mappingRevision:2,state:'active',workFolder:cwd,artifactsDir:cwd};
  let denied=false;
  const request=vi.fn(async()=>new Response(JSON.stringify(denied?{ok:false,error:'project_membership_required'}:{ok:true,mapping,project:{id:'p',primaryRoomId:'r',requiredProtocol:'room_workspace_v1'},tasks:[{id:'p__t',assignedAgent:'a'}]}),{status:denied?403:200}));
  const adapter=createRoomWorkspaceProjectAdapter({kswarmRequest:request,broker:{request:vi.fn()},journal:{getRecord:()=>undefined,saveRecord:()=>{}}});
  const context:any={roomId:'r',workspaceId:'w',originHostId:'h',bindingId:'b',generation:1,mappingRevision:2,logicalAgentId:'a',effectiveCwd:cwd,contextScope:{kind:'project',projectId:'p'}};
  expect((await adapter.resolve({roomId:'r',projectId:'p',logicalAgentId:'a',taskId:'p__t'})).mapping.workFolder).toBe(cwd);
  await adapter.authorize(context,'p__t');mapping.generation=2;
  await expect(adapter.authorize(context,'p__t')).rejects.toThrow('workspace_project_mapping_changed');
  denied=true;await expect(adapter.authorize(context,'p__t')).rejects.toThrow('project_membership_required');
});
