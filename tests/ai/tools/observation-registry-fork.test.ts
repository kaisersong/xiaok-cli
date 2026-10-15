import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';
const tool=(name:string,result:string):Tool=>({permission:'safe',definition:{name,description:name,inputSchema:{type:'object',properties:{}}},execute:async()=>result});
describe('host observation registry isolation',()=>{
 it('keeps separate owner recall definitions and rejects search/delegation',async()=>{
  const parent=new ToolRegistry({autoMode:true},[tool('read','native'),tool('spawn_agent','child')]);
  const a=parent.forkForObservation([tool('observation_read','a')],['read']);
  const b=parent.forkForObservation([tool('observation_read','b')],['read']);
  expect(await a.executeTool('observation_read',{})).toBe('a');expect(await b.executeTool('observation_read',{})).toBe('b');
  expect(await a.executeTool('tool_search',{query:'spawn'})).toMatch(/Error/);expect(await a.executeTool('spawn_agent',{})).toMatch(/Error/);
  expect(parent.getToolDefinitions().some(t=>t.name==='observation_read')).toBe(false);
  a.dispose();b.dispose();parent.dispose();
 });
 it('rejects replaced parent native tools before execution',async()=>{
  const parent=new ToolRegistry({autoMode:true},[tool('read','old')]);const fork=parent.forkForObservation([],['read']);
  parent.registerTool(tool('read','new'));expect(await fork.executeTool('read',{})).toMatch(/authorization changed/);
  fork.dispose();parent.dispose();
 });
 it('uses original user permission prompt and never auto-approves',async()=>{
  let prompted=0,executed=0;const native={...tool('bash','ok'),permission:'bash' as const,execute:async()=>{executed++;return 'ok';}};
  const parent=new ToolRegistry({onPrompt:async()=>{prompted++;return false;}},[native]);const fork=parent.forkForObservation([],['bash']);
  expect(await fork.executeTool('bash',{command:'echo ok'})).toMatch(/Error|denied|拒绝|已取消/);expect(prompted).toBe(1);expect(executed).toBe(0);
  fork.dispose();parent.dispose();
 });
 it('notices parent replacement while original pre-hook is awaited',async()=>{
  let unblock!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{unblock=r;}),started=new Promise<void>(r=>{entered=r;});
  let executed=0;const native={...tool('read','old'),execute:async()=>{executed++;return 'old';}};
  const parent=new ToolRegistry({autoMode:true,hookInputMode:'direct-callback',hooksRunner:{runPreHooks:async()=>{entered();await waiting;return {ok:true};},runPostHooks:async()=>[],runHooks:async()=>({ok:true})}},[native]);
  const fork=parent.forkForObservation([],['read']),pending=fork.executeTool('read',{});await started;parent.unregisterTool('read');unblock();
  expect(await pending).toMatch(/authorization changed/);expect(executed).toBe(0);fork.dispose();parent.dispose();
 });

 it('task default permission intersects parent auto and still prompts',async()=>{
  let prompts=0;const parent=new ToolRegistry({autoMode:true},[{...tool('bash','ok'),permission:'bash'}]);
  const fork=parent.forkForObservation([],['bash'],{mode:'default',onPrompt:async()=>{prompts++;return false;}});
  expect(await fork.executeTool('bash',{command:'echo ok'})).toContain('已取消');expect(prompts).toBe(1);fork.dispose();parent.dispose();
 });
 it('task auto cannot override parent deny and parent revision reaches observer',async()=>{
  const permission=new PermissionManager({mode:'auto',denyRules:['bash:*']});
  const parent=new ToolRegistry({permissionManager:permission},[{...tool('bash','bad'),permission:'bash'}]);
  const fork=parent.forkForObservation([],['bash'],{mode:'auto',onPrompt:async()=>true});let revisions=0;
  const unsubscribe=fork.getObservationPermissionRevisionPort().onRevisionChanged(()=>{revisions++;});
  expect(await fork.executeTool('bash',{command:'echo ok'})).toMatch(/拒绝|denied|权限不足/);permission.addSessionDenyRule('write');expect(revisions).toBe(1);
  unsubscribe();fork.dispose();parent.dispose();
 });

});

it('admits only the exact host-branded delegation tool and rejects copies or changed handlers',async()=>{
 const {brandObservationDelegationTool}=await import('../../../src/runtime/sol-pi/delegation-tool-brand.js');
 const parent=new ToolRegistry({autoMode:true},[tool('read','native')]);
 const delegated=tool('subagent','child');
 expect(()=>parent.forkForObservation([delegated],['read'])).toThrow();
 brandObservationDelegationTool(delegated);
 const fork=parent.forkForObservation([delegated],['read']);
 expect(await fork.executeTool('subagent',{})).toBe('child');
 expect(()=>parent.forkForObservation([{...delegated}],['read'])).toThrow();
 delegated.execute=async()=> 'changed';
 expect(await fork.executeTool('subagent',{})).toMatch(/authorization changed/);
 expect(()=>parent.forkForObservation([delegated],['read'])).toThrow();
 fork.dispose();parent.dispose();
});
