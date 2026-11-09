import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationMcpActivities} from '../../../src/runtime/conversation-activity/mcp.js';
import type {McpClientConnection} from '../../../src/platform/mcp/transport.js';
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
describe('original MCP endpoint preparation ordering',()=>{
 const cleanup:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
 function fixture(){
  const root=mkdtempSync(join(tmpdir(),'attention-prepare-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new ConversationActivityStore(join(root,'activity.sqlite'));cleanup.push(()=>store.close());
  const service=new ConversationActivityService({store,actorId:'user',profileId:'profile',getThread:threadId=>({threadId,profileId:'profile',workspaceId:'workspace',deleteState:'none'}),canObserveWork:()=>true});cleanup.push(()=>service.close());
  const origin=vi.fn(async()=> 'thread'),mcp=new ConversationMcpActivities({store,service,actorId:'user',originThread:origin});cleanup.push(()=>mcp.close());
  const connection=()=>({client:{},tasks:{endpointId:'endpoint',capabilities:{execution:true}},activityEndpoint:{name:'fixture',config:{type:'stdio'}}}) as unknown as McpClientConnection;
  const a=connection(),b=connection();mcp.register(a);return{store,service,mcp,origin,a,b};
 }
 it('never lets an old origin continuation register after a replacement is current',async()=>{
  const f=fixture(),held=gate();f.origin.mockImplementationOnce(async()=>{await held.promise;return'thread';});const register=vi.spyOn(f.service,'registerMcpReader');
  const old=f.mcp.observer('task','old',f.a);await vi.waitFor(()=>expect(f.origin).toHaveBeenCalledOnce());f.mcp.register(f.b);
  const next=f.mcp.observer('task','next',f.b);await Promise.resolve();expect(register).not.toHaveBeenCalled();held.release();expect(await old).toBeUndefined();expect(await next).toBeDefined();expect(register).toHaveBeenCalledOnce();expect(f.store.getAssociation('mcp:old')).toBeNull();
 });
 it('finishes the actual old register before starting the replacement register and does not revive its source birth',async()=>{
  const f=fixture(),held=gate(),original=f.service.registerMcpReader.bind(f.service);let entered=false;
  const register=vi.spyOn(f.service,'registerMcpReader').mockImplementationOnce(async(...args)=>{entered=true;await held.promise;return original(...args);});
  const old=f.mcp.observer('task','old',f.a);await vi.waitFor(()=>expect(entered).toBe(true));f.mcp.register(f.b);const next=f.mcp.observer('task','next',f.b);
  await Promise.resolve();expect(register).toHaveBeenCalledOnce();held.release();expect(await old).toBeUndefined();expect(await next).toBeDefined();expect(register).toHaveBeenCalledTimes(2);expect(f.store.getAssociation('mcp:old')).toBeNull();
 });
});
