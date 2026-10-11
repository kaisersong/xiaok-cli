import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('tool identity contracts', () => {
  it('resolves legacy select aliases to the same built-in tool identity used by execution', () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
    });

    const selected = registry.searchTools('select:Read');

    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe('read');
  });

  it('deduplicates built-in, deferred, and capability search entries that share one logical tool identity', () => {
    const capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register({
      kind: 'tool',
      name: 'READ',
      description: 'legacy read alias from a capability registry',
    });

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      capabilityRegistry,
    });

    registry.registerDeferredTool({
      name: 'Read',
      description: 'legacy deferred alias for read',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });

    const readEntries = registry.searchTools('read').filter((tool) => tool.name.toLowerCase() === 'read');

    expect(readEntries).toHaveLength(1);
    expect(readEntries[0]?.name).toBe('read');
  });
});


describe('tool description sidecars',()=>{
 const metadata={outputSchema:{type:'string'},effect:'read',idempotency:'unknown'} as const;
 const make=(name:string)=>({definition:{name,description:name,inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=> 'ok'}) as any;
 it('preserves legacy references and exact shapes while capturing registration metadata',()=>{
  const tool=make('Read'),raw:any=structuredClone(metadata),registry=new ToolRegistry({},[],undefined as any);
  (registry as any).registerTool(tool,raw);raw.effect='write';
  expect(registry.getRegisteredTool('Read')).toBe(tool);expect(registry.getToolDefinitions().find(x=>x.name==='Read')).toBe(tool.definition);
  expect(Object.keys(tool.definition)).toEqual(['name','description','inputSchema']);expect(Object.keys(tool)).toEqual(['definition','permission','execute']);
  expect((registry as any).getToolDiscoveries().find((x:any)=>x.coreDefinition===tool.definition).metadata).toEqual(metadata);
  (registry as any).registerTool(tool);expect((registry as any).searchToolDiscoveries('select:read')[0].metadata).toBeUndefined();registry.dispose();
 });
 it('keeps metadata on the actual alias winner, including select last-wins',()=>{
  const active=make('read'),deferred=make('Read').definition,registry=new ToolRegistry({},[active]);
  (registry as any).registerTool(active,metadata);(registry as any).registerDeferredTool(deferred,{effect:'write'});
  expect((registry as any).searchToolDiscoveries('read')[0]).toEqual({coreDefinition:active.definition,metadata});
  expect((registry as any).searchToolDiscoveries('select:read')[0]).toEqual({coreDefinition:deferred,metadata:{effect:'write'}});
  expect(registry.searchTools('select:read')[0]).toBe(deferred);registry.unregisterTool('Read');expect((registry as any).searchDeferredToolDiscoveries('read')).toEqual([]);
 });
 it('serializes new descriptions through real tool_search while legacy JSON is identical',async()=>{
  const tool=make('custom_read'),registry=new ToolRegistry({},[tool]);
  const legacy=await registry.executeTool('tool_search',{query:'custom_read'});expect(legacy).toBe(JSON.stringify([tool.definition],null,2));
  (registry as any).registerTool(tool,metadata);expect(JSON.parse(await registry.executeTool('tool_search',{query:'custom_read'}))).toEqual([{...tool.definition,...metadata}]);expect(Object.keys(tool.definition)).toHaveLength(3);
 });
 it('rejects illegal metadata before registry generation/capability changes and supports default read/forks',()=>{
  const registry=new ToolRegistry({}),tool=registry.getRegisteredTool('read')!,current=registry.captureObservationRegistryCurrent();
  expect(()=> (registry as any).registerTool(tool,{effect:'invalid'})).toThrow();expect(current).not.toThrow();
  expect((registry as any).searchToolDiscoveries('select:read')[0].metadata).toEqual(metadata);
  const fork=registry.forkForObservation([],['read']);expect((fork as any).searchToolDiscoveries('select:read')[0].metadata).toEqual(metadata);registry.registerTool(tool);expect(()=>fork.captureObservationRegistryCurrent()).toThrow();
 });
});


it('freezes capability discovery envelopes without freezing legacy core projections',()=>{
 const capabilities=new CapabilityRegistry();capabilities.register({kind:'mcp',name:'external',description:'external'});const registry=new ToolRegistry({capabilityRegistry:capabilities},[]);
 const discovery=registry.searchToolDiscoveries('external')[0];expect(Object.isFrozen(discovery)).toBe(true);expect(Object.isFrozen(discovery.coreDefinition)).toBe(false);expect(discovery).not.toHaveProperty('metadata');registry.dispose();
});
