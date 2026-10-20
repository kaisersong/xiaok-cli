// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { ContinuityMcpController } from '../../electron/context-continuity/mcp-control.js';
const actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'};
let root:string,service:ContinuityService,control:ContinuityMcpController,ready:boolean;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'mcp-control-'));ready=false;service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});control=new ContinuityMcpController(service,actor,undefined,()=>ready);});
afterEach(async()=>{await control.close();service.close();rmSync(root,{recursive:true,force:true});});
it('defaults off and requires completed main ownership initialization before listening',async()=>{
 expect(control.status()).toEqual({enabled:false,state:'disabled',url:null});await expect(control.setEnabled(true)).rejects.toThrow('continuity_not_ready');
 ready=true;const status=await control.setEnabled(true);expect(status.state).toBe('listening');expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
 await control.setEnabled(false);await expect(fetch(status.url!)).rejects.toThrow();expect(control.status().state).toBe('disabled');
});
it('restores a previously enabled endpoint on exactly the persisted port after owner readiness',async()=>{
 ready=true;const before=await control.setEnabled(true);await control.close();control=new ContinuityMcpController(service,actor,undefined,()=>ready);
 expect(control.status()).toMatchObject({enabled:true,state:'unavailable',url:null});await control.restore();expect(control.status().url).toBe(before.url);
});
it('creates an explicit one-time client config without storing its bearer in settings or operation results',async()=>{
 ready=true;const c=service.createConversation(actor,{operationId:'c'}),target=service.createConversation(actor,{operationId:'t'});
 service.recordMessage(actor,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'task_one',sourceMessageId:'m',sourceDataEpoch:'epoch',sourceRevision:1,role:'assistant',text:'body',executionState:'settled'});
 const ref=service.createReference(actor,{conversationId:c.id,expectedRevision:service.getConversation(actor,c.id)!.revision,operationId:'r'});
 service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'g'});
 const result=await control.issue({operationId:'issue',targetConversationId:target.id,refIds:[ref.refId]});const config=JSON.parse(result.clientConfig);
 expect(config.mcpServers['xiaok-context'].url).toBe(control.status().url);expect(config.mcpServers['xiaok-context'].headers.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
 expect(service.store.db.prepare('SELECT result FROM operations WHERE kind=?').get('issueExternalReader')?.result).not.toContain('Bearer');
 await control.resetPort();expect(()=>service.authenticateExternalReader(config.mcpServers['xiaok-context'].headers.Authorization.slice(7))).toThrow('not_readable');expect(service.listExternalReaders(actor)[0].revoked).toBe(true);
});
it('recovers a port collision only through an explicit port reset that revokes existing credentials',async()=>{
 ready=true;const before=await control.setEnabled(true);await control.close();
 const blocker=createServer((_req,res)=>res.end());await new Promise<void>(resolve=>blocker.listen(Number(new URL(before.url!).port),'127.0.0.1',resolve));
 control=new ContinuityMcpController(service,actor,undefined,()=>ready);
 try{
  await expect(control.restore()).rejects.toThrow();expect(control.status()).toMatchObject({state:'unavailable',url:null});
  const result=await control.resetPort();expect(result.state).toBe('listening');expect(result.url).not.toBe(before.url);
 }finally{await new Promise<void>(resolve=>blocker.close(()=>resolve()));}
});
