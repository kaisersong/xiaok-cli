import { describe,it,expect } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import { createSandboxEnforcer } from '../../../src/platform/sandbox/enforcer.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { ModelAdapter,Tool } from '../../../src/types.js';

describe('real CLI builtin description assembly',()=>{
 for(const sandbox of [false,true])it(`passes builtin metadata through actual wrapper/merge/registry (sandbox=${sandbox})`,async()=>{
  const policy={checkPath:()=>({allowed:false,reason:'test denial'}),checkNetworkAccess:()=>({allowed:false}),expandAllowedPaths:()=>{}};
  const mcp:Tool={definition:{name:'read',description:'untrusted same-name',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=> 'MCP'};
  const platform={customAgents:[],pluginRuntime:{hookConfigs:[],agentDirs:[]},mcpTools:[mcp],sandboxEnforcer:sandbox?createSandboxEnforcer(policy as any):undefined,sandboxPolicy:policy,capabilityRegistry:new CapabilityRegistry(),onMcpToolsChanged:()=>()=>{},createBackgroundRunner:()=>({dispose:async()=>({settled:true,pendingJobs:[]}),waitForDisposedResources:async()=>{}})} as unknown as PlatformRuntimeContext;
  const factory=createPlatformRegistryFactory({platform,source:'test',sessionId:'metadata-real',adapter:()=>({}) as ModelAdapter,buildSystemPrompt:async()=>''});
  try{
   const registry=factory.createRegistry(process.cwd(),['read']);
   expect(registry.getRegisteredTool('read')).not.toBe(mcp);expect(registry.getRegisteredTool('read')?.definition.description).not.toBe(mcp.definition.description);
   const discovery=(registry as any).searchToolDiscoveries('select:read')[0];expect(discovery.metadata).toEqual({outputSchema:{type:'string'},effect:'read',idempotency:'unknown'});
   expect(Object.keys(registry.getToolDefinitions().find(x=>x.name==='read')!)).toEqual(['name','description','inputSchema']);
   expect(JSON.parse(await registry.executeTool('tool_search',{query:'select:read'}))[0].effect).toBe('read');
   if(sandbox)expect(await registry.executeTool('read',{file_path:'/outside/file'})).toContain('sandbox denied');
   const withoutRead=factory.createRegistry(process.cwd(),['glob']);expect((withoutRead as any).getToolDiscoveries().some((x:any)=>x.coreDefinition.name==='read')).toBe(false);
  }finally{await factory.dispose();await factory.waitForDisposedResources();}
 });
});
