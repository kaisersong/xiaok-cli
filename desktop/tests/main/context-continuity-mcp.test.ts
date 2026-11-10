// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { ContinuityMcpEndpoint } from '../../electron/context-continuity/mcp.js';
import {digest} from '../../electron/context-continuity/store.js';
const actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'};
let root:string,service:ContinuityService,endpoint:ContinuityMcpEndpoint,url:string,secret:string,refId:string,grantId:string;
beforeEach(async()=>{
 root=mkdtempSync(join(tmpdir(),'continuity-mcp-'));service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});
 const source=service.createConversation(actor,{operationId:'source'}),target=service.createConversation(actor,{operationId:'target'});
 service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'task_source',sourceDataEpoch:'epoch',sourceMessageId:'one',sourceRevision:1,role:'assistant',text:'"\\\n😀'.repeat(30000),executionState:'settled'});
 const c=service.getConversation(actor,source.id)!;refId=service.createReference(actor,{conversationId:c.id,expectedRevision:c.revision,operationId:'ref'}).refId;
 grantId=service.attachReference(actor,{refId,targetConversationId:target.id,operationId:'grant'}).grantId;
 secret=service.issueExternalReader(actor,{operationId:'issue',targetConversationId:target.id,refIds:[refId]}).secret;
 endpoint=new ContinuityMcpEndpoint({service});url=await endpoint.start(0);
});
afterEach(async()=>{await endpoint.close();service.close();rmSync(root,{recursive:true,force:true});});
async function rpc(method:string,params:unknown={},headers:Record<string,string>={},token:string|null=secret){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
it('authenticates initialize/list/notifications, rejects rebinding and origins, and exposes no SSE bypass',async()=>{
 expect((await rpc('tools/list',{}, {},null)).status).toBe(401);
 expect((await rpc('initialize',{}, {},'A'.repeat(43))).status).toBe(401);
 expect((await rpc('notifications/initialized',{}, {},null)).status).toBe(401);
 const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=request(url,{method:'POST',headers:{Host:'attacker.example',Authorization:`Bearer ${secret}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 expect(hostStatus).toBe(403);
 expect((await rpc('tools/list',{}, {Origin:'https://attacker.example'})).status).toBe(403);
 expect((await fetch(url,{headers:{Authorization:`Bearer ${secret}`,Accept:'text/event-stream'}})).status).toBe(405);
 expect((await rpc('tools/list',{}, {},secret)).status).toBe(200);
 expect((await fetch(url+'?token='+secret,{method:'POST'})).status).toBe(404);
});
it('supports a real SDK client with exact paged text and bounded final MCP envelopes',async()=>{
 const client=new Client({name:'continuity-test',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${secret}`}}}));
 try{
  expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['resolve_context_reference']);
  let cursor:string|undefined,body='',pages=0;
  do{
   const result=await client.callTool({name:'resolve_context_reference',arguments:{refId,...(cursor?{cursor}:{})}});
   expect(result.isError).not.toBe(true);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65536);
   const page=JSON.parse((result.content as Array<{text:string}>)[0].text);body+=page.messages.map((m:{text:string})=>m.text).join('');cursor=page.nextCursor;pages++;
  }while(cursor&&pages<100);
  expect(cursor).toBeUndefined();expect(body).toBe('"\\\n😀'.repeat(30000));expect(pages).toBeGreaterThan(1);
  const fake=await client.callTool({name:'resolve_context_reference',arguments:{refId,actorId:'desktop-user:p',targetConversationId:'other'}});expect(fake.isError).toBe(true);
  service.revokeGrant(actor,{grantId});await expect(client.listTools()).rejects.toThrow();
 }finally{await client.close();}
 expect(endpoint.activeRequests).toBe(0);
});
it('limits bodies, closes per-request resources, and rechecks authorization before response disclosure',async()=>{
 expect((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:'x'.repeat(17000)})).status).toBe(413);
 const result=await rpc('tools/call',{name:'resolve_context_reference',arguments:{refId}});expect(result.status).toBe(200);expect(Buffer.byteLength(await result.text())).toBeLessThan(65536);
 expect(endpoint.activeRequests).toBe(0);
 await endpoint.close();expect(endpoint.activeRequests).toBe(0);
});
it('does not disclose a body when permission changes during owner refresh',async()=>{
 await endpoint.close();endpoint=new ContinuityMcpEndpoint({service,refresh:async()=>{service.revokeGrant(actor,{grantId});}});url=await endpoint.start(0);
 const result=await rpc('tools/call',{name:'resolve_context_reference',arguments:{refId}});expect(result.status).toBe(401);expect(await result.text()).not.toContain('source');
});
it('disposes an in-flight request even while its owner refresh is awaiting IO',async()=>{
 await endpoint.close();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 endpoint=new ContinuityMcpEndpoint({service,refresh:()=>pending});url=await endpoint.start(0);
 const call=rpc('tools/list').catch(()=>null);await vi.waitFor(()=>expect(endpoint.activeRequests).toBe(1));
 await endpoint.close();expect(endpoint.activeRequests).toBe(0);release();await call;
});
it('rechecks the actual frozen page version after asynchronous MCP encoding and before HTTP bytes leave main',async()=>{
 const original=service.resolveExternalReference.bind(service);
 vi.spyOn(service,'resolveExternalReference').mockImplementation((principal,input)=>{
  const page=original(principal,input);queueMicrotask(()=>{
   const row=service.store.db.prepare('SELECT record FROM message_versions WHERE message_id=? AND revision=?').get(page.messages[0].messageId,page.messages[0].revision)!;
   const record=JSON.parse(String(row.record));record.text='MCP_LATE_VERSION_CHANGED';record.contentHash=digest(record.text);
   service.store.db.prepare('UPDATE message_versions SET record=? WHERE message_id=? AND revision=?').run(JSON.stringify(record),page.messages[0].messageId,page.messages[0].revision);
  });return page;
 });
 const result=await rpc('tools/call',{name:'resolve_context_reference',arguments:{refId}});
 expect(result.status).toBe(401);expect(await result.text()).toBe('{"error":"not_authorized"}');
});
