// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, isSettledLocalTool } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';

const makeTool = (name = 'local_reader'): Tool => ({ permission: 'safe', definition: {
  name, description: 'test known local implementation', inputSchema: { type: 'object', properties: {} },
}, execute: async () => 'LOCAL_RESULT' });
function context() {
  const recorded: string[] = [];
  return { recorded, value: { taskId: 'local_task', recordUnprovenEffect: (name: string) => recorded.push(name) } as ToolExecutionContext };
}
function host(tool: Tool, options: ConstructorParameters<typeof ToolRegistry>[0] = {}) {
  return new ToolRegistry({ autoMode: true, requireEffectGuard: true, settledLocalExecutors: new Map([[tool, tool.execute]]), ...options }, [tool]);
}

describe('known local execution requires the exact host implementation throughout the real registry path', () => {
  it('does not call prompt even when the actual permission decision is prompt, and fully awaits local work', async () => {
    let release!: () => void;
    const tool = makeTool(); tool.execute = async () => { await new Promise<void>(resolve => { release = resolve; }); return 'SETTLED'; };
    const onPrompt = vi.fn(async () => true);
    const permissionManager = new PermissionManager({mode:'auto'});
    const registry = host(tool, { onPrompt, permissionManager }); const c = context();
    vi.spyOn(permissionManager, 'check').mockResolvedValue('prompt');
    let done = false; const running = registry.executeTool('local_reader', {}, c.value).then(value => { done = true; return value; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(done).toBe(false); expect(c.recorded).toEqual([]); expect(onPrompt).not.toHaveBeenCalled();
    release(); expect(await running).toBe('SETTLED'); registry.dispose();
  });

  it('records a same-name replacement, copied object, and unqualified companion as unknown', async () => {
    const original = makeTool(); const companion = makeTool('companion'); original.companionTools = [companion];
    const registry = host(original); const c = context();
    await registry.executeTool('companion', {}, c.value); expect(c.recorded).toContain('companion'); c.recorded.length = 0;
    registry.registerTool({ ...original });
    await registry.executeTool('local_reader', {}, c.value); expect(c.recorded).toContain('local_reader');
    registry.dispose();
  });

  it('keeps unknown admission once a non-safe prompt callback ran even if it restores safe permission', async () => {
    const tool = makeTool(); const permissionManager = new PermissionManager({mode:'auto'});
    const onPrompt = vi.fn(async () => { wrapped.permission = 'safe'; return true; });
    const registry = host(tool, { permissionManager, onPrompt });
    const wrapped = registry.getRegisteredTool('local_reader')!;
    vi.spyOn(permissionManager, 'check').mockImplementation(async () => { wrapped.permission = 'write'; return 'prompt'; });
    const c = context();
    expect(await registry.executeTool('local_reader', {}, c.value)).toBe('LOCAL_RESULT');
    expect(onPrompt).toHaveBeenCalledTimes(1); expect(c.recorded).toContain('local_reader'); registry.dispose();
  });

  it('waits for an unexpected asynchronous authority check and records it as unknown before rejecting', async () => {
    let release!: () => void; let started = false;
    const original = makeTool(); const actual = vi.spyOn(original, 'execute');
    const registry = new DesktopOwnedToolRegistry({ autoMode: true, settledLocalExecutors: new Map([[original, original.execute]]) }, [original]);
    const bridge = new DesktopToolCatalogBridge({registry,workspaceId:'workspace'}); bridge.authorizeRoot();
    const scope = bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(), {
      groupId:'group',agentId:'root_group',turnId:'turn',cwd:process.cwd(),workspaceId:'workspace',materialIds:[],permissionRevision:0,
      signal:new AbortController().signal,deadlineAt:Date.now()+60_000,
      assertCurrent: async () => { started = true; await new Promise<void>(resolve => {release=resolve;}); },
    }, {autoMode:true,requireEffectGuard:true});
    const c = context(); let done = false;
    const running = scope.registry.executeTool('local_reader',{},c.value).then(value => {done=true;return value;});
    await vi.waitFor(() => expect(started).toBe(true)); expect(done).toBe(false);
    expect(c.recorded).toContain('local_operation_check_not_synchronous'); expect(actual).not.toHaveBeenCalled();
    release(); expect(await running).toContain('local_operation_check_not_synchronous');
    scope.dispose();bridge.dispose();registry.dispose();
  });

  it('waits for the first monitor admission check even if later catalog checks would be synchronous', async () => {
    const original = makeTool(); const registry = host(original); const c = context();
    let release!:()=>void; let calls=0; let done=false;
    c.value.assertContextAdmission = () => { if(++calls===1) return new Promise<void>(resolve=>{release=resolve;}); };
    const running=registry.executeTool('local_reader',{},c.value).then(value=>{done=true;return value;});
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    const prematurelyDone=done; release(); const result=await running;
    expect(prematurelyDone).toBe(false); expect(result).toContain('local_operation_check_not_synchronous');
    expect(c.recorded).toContain('local_operation_check_not_synchronous'); registry.dispose();
  });

  it.each(['decline','throw'] as const)('records before a non-safe prompt callback can %s and restore safe permission', async outcome => {
    const original=makeTool();const permissionManager=new PermissionManager({mode:'auto'});const c=context();
    const onPrompt=vi.fn(async()=>{wrapped.permission='safe';expect(c.recorded).toContain('local_reader');if(outcome==='throw')throw new Error('prompt failure');return false;});
    const registry=host(original,{permissionManager,onPrompt});const wrapped=registry.getRegisteredTool('local_reader')!;
    vi.spyOn(permissionManager,'check').mockImplementation(async()=>{wrapped.permission='write';return 'prompt';});
    if(outcome==='throw')await expect(registry.executeTool('local_reader',{},c.value)).rejects.toThrow('prompt failure');
    else await registry.executeTool('local_reader',{},c.value);
    expect(onPrompt).toHaveBeenCalledTimes(1);expect(c.recorded).toContain('local_reader');registry.dispose();
  });

  it('awaits an asynchronous authority check even when the durable unknown recorder throws', async () => {
    let release!:()=>void;let started=false;let done=false;
    const original=makeTool();const registry=new DesktopOwnedToolRegistry({autoMode:true,settledLocalExecutors:new Map([[original,original.execute]])},[original]);
    const bridge=new DesktopToolCatalogBridge({registry,workspaceId:'workspace'});bridge.authorizeRoot();
    const scope=bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(),{groupId:'group',agentId:'root_group',turnId:'turn',cwd:process.cwd(),workspaceId:'workspace',materialIds:[],permissionRevision:0,signal:new AbortController().signal,deadlineAt:Date.now()+60_000,
      assertCurrent:async()=>{started=true;await new Promise<void>(resolve=>{release=resolve;});}}, {autoMode:true,requireEffectGuard:true});
    const c=context();c.value.recordUnprovenEffect=()=>{throw new Error('durable recorder unavailable');};
    const running=scope.registry.executeTool('local_reader',{},c.value).then(value=>{done=true;return value;});
    await vi.waitFor(()=>expect(started).toBe(true));const prematurelyDone=done;release();
    expect(await running).toContain('durable recorder unavailable');expect(prematurelyDone).toBe(false);
    scope.dispose();bridge.dispose();registry.dispose();
  });

  it('does not qualify a rewritten original execute or a foreign pinned execute', async () => {
    const original = makeTool(); const registry = host(original); const c = context();
    original.execute = async () => 'REWRITTEN';
    expect(isSettledLocalTool(registry.getRegisteredTool('local_reader')!)).toBe(false);
    expect(await registry.executeTool('local_reader', {}, c.value)).toBe('LOCAL_RESULT'); expect(c.recorded).toContain('local_reader'); registry.dispose();
    const foreign = host(original, { settledLocalExecutors: new Map([[original, makeTool().execute]]) }); c.recorded.length = 0;
    await foreign.executeTool('local_reader', {}, c.value); expect(c.recorded).toContain('local_reader'); foreign.dispose();
  });

  it('does not carry qualification into a nested unknown tool through ToolExecutionContext', async () => {
    const nested = host(makeTool('known_elsewhere')); const outer = makeTool();
    outer.execute = async (_input, ctx) => nested.executeTool('unknown', {}, ctx);
    nested.registerTool(makeTool('unknown')); const registry = host(outer); const c = context();
    expect(await registry.executeTool('local_reader', {}, c.value)).toBe('LOCAL_RESULT');
    expect(c.recorded).toContain('unknown'); expect(c.value.recordUnprovenEffect).toBeTypeOf('function');
    registry.dispose(); nested.dispose();
  });

  it.each(['onToolObserved', 'protectedOutputGuard'] as const)('does not qualify a registry with unreviewed %s callbacks', async kind => {
    const options = kind === 'onToolObserved' ? { onToolObserved: vi.fn() } : { protectedOutputGuard: { getProtectedArtifacts: () => [] } };
    const registry = host(makeTool(), options); const c = context();
    await registry.executeTool('local_reader', {}, c.value); expect(c.recorded).toContain('local_reader'); registry.dispose();
  });

  it('passes only the pinned root forwarding implementation through the real catalog; caller callbacks and child scopes remain unknown', async () => {
    const original = makeTool();
    const registry = new DesktopOwnedToolRegistry({ autoMode: true, settledLocalExecutors: new Map([[original, original.execute]]) }, [original]);
    const bridge = new DesktopToolCatalogBridge({ registry, workspaceId: 'workspace' }); bridge.authorizeRoot();
    const scope = (agentId: string, options = {}) => bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(), {
      groupId: 'group', agentId, turnId: 'turn', cwd: process.cwd(), workspaceId: 'workspace', materialIds: [], permissionRevision: 0,
      signal: new AbortController().signal, deadlineAt: Date.now() + 60_000,
    }, { requireEffectGuard: true, autoMode: true, ...options });
    const root = scope('root_group'); const c = context();
    expect(await root.registry.executeTool('local_reader', {}, c.value)).toBe('LOCAL_RESULT'); expect(c.recorded).toEqual([]);
    const callbacks = scope('root_group', { onPrompt: async () => true });
    await callbacks.registry.executeTool('local_reader', {}, c.value); expect(c.recorded).toContain('local_reader'); c.recorded.length = 0;
    const child = scope('child'); expect(await child.registry.executeTool('local_reader', {}, c.value)).toContain('tool_scope_unsupported');
    // A denied child cannot execute the root-only implementation.
    registry.registerTool(makeTool()); bridge.authorizeRoot(); c.recorded.length = 0;
    expect(await root.registry.executeTool('local_reader', {}, c.value)).toBe('LOCAL_RESULT'); expect(c.recorded).toContain('local_reader');
    root.dispose(); callbacks.dispose(); child.dispose(); bridge.dispose(); registry.dispose();
  });
});
