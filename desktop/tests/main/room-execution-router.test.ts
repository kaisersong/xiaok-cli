import { describe, expect, it, vi } from 'vitest';
import { createRoomExecutionRouter } from '../../electron/room-execution-router.js';

describe('main-owned Room execution capability routing', () => {
  it('checks the original per-request guard after installation discovery before calling the probe',async()=>{
    let allowed=true;const sentinel=Error('original_room_route_revoked'),probe=vi.fn(async(runtime:any)=>({protocol:'room_discussion_v1' as const,runtime,supported:true}));
    const router=createRoomExecutionRouter({request:async path=>({ok:true,json:async()=>path==='/agents'?{agents:[{id:'a',runtimeType:'qoder',execution:{mode:'self_running',participantId:'a'}}]}:{runtimes:[{type:'qoder',path:'/owned/qoder'}]}}),canonicalExecutable:async path=>{allowed=false;return path;},makeAdapter:()=>({probe,execute:vi.fn()})});
    let failure:unknown;try{await Reflect.apply(router.resolve,router,['a',()=>{if(!allowed)throw sentinel;}]);}catch(error){failure=error;}
    expect(probe).not.toHaveBeenCalled();expect(failure).toBe(sentinel);
  });
  it('preserves the original guard failure instead of retrying it into unavailable metadata',async()=>{
    let installed=false,thrown=false;const sentinel=Error('original_guard_io_unknown'),probe=vi.fn();
    const router=createRoomExecutionRouter({request:async path=>({ok:true,json:async()=>path==='/agents'?{agents:[{id:'a',runtimeType:'qoder',execution:{mode:'self_running',participantId:'a'}}]}:{runtimes:[{type:'qoder',path:'/owned/qoder'}]}}),canonicalExecutable:async path=>{installed=true;return path;},makeAdapter:()=>({probe,execute:vi.fn()})});
    let failure:unknown;try{await router.resolve('a',()=>{if(installed&&!thrown){thrown=true;throw sentinel;}});}catch(error){failure=error;}
    expect(probe).not.toHaveBeenCalled();expect(failure).toBe(sentinel);
  });
  it('binds actual KSwarm runtime identity, never a display name or renderer path', async () => {
    const probe = vi.fn(async (runtime) => ({ protocol: 'room_discussion_v1', runtime, supported: true, proof: { freshSession: true, toolsDisabled: true, mcpDisabled: true, hooksDisabled: true } }));
    const execute = vi.fn(async () => ({ text: 'real CLI', resourcesReleased: true }));
    const router = createRoomExecutionRouter({ request: async path => ({ ok: true, json: async () => path === '/agents' ? { agents: [
      { id: 'a', name: 'qoder', runtimeType: 'kiro', execution: { mode: 'self_running', participantId: 'a' } },
      { id: 'b', runtimeType: 'qoder', runtimePath: '/installed/qoder', execution: { mode: 'self_running', participantId: 'b' } },
      { id: 'c', runtimeType: 'qoder', runtimePath: '/other/qoder', execution: { mode: 'self_running', participantId: 'c' } },
      { id: 'hosted', runtimeSource: 'desktop-agent-runtime' },
      { id: 'conflict', participantId: 'other-host', execution: { mode: 'hosted', hostParticipantId: 'xiaok-desktop' } },
      { id: 'external-conflict', runtimeType: 'qoder', participantId: 'other-agent', execution: { mode: 'self_running', participantId: 'external-conflict' } },
    ] } : { runtimes: [{ type: 'qoder', path: '/installed/qoder' }] } }), canonicalExecutable: async value => value,
      makeAdapter: () => ({ probe, execute }) });
    expect(await router.resolve('hosted')).toBeNull();
    expect(await router.resolve('a')).toMatchObject({ supported: false, runtime: 'kiro' });
    expect(await router.resolve('b')).toMatchObject({ supported: true, runtime: 'qoder', logicalAgentId: 'b' });
    expect(await router.resolve('c')).toMatchObject({ supported: false, reason: 'runtime_identity_mismatch' });
    expect(await router.resolve('unknown')).toMatchObject({ supported: false });
    expect(await router.resolve('conflict')).toMatchObject({ supported: false });
    expect(await router.resolve('external-conflict')).toMatchObject({ supported: false, reason: 'runtime_identity_mismatch' });
    expect(await router.capabilities(['hosted', 'b', 'a'])).toMatchObject([
      { logicalAgentId: 'hosted', mode: 'workspace_worker' },
      { logicalAgentId: 'b', mode: 'discussion_only' },
      { logicalAgentId: 'a', mode: 'discussion_unavailable' },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(probe.mock.calls.every(([runtime]) => runtime === 'qoder')).toBe(true);
  });
  it('fails closed when authoritative agent discovery is unavailable', async () => {
    const router = createRoomExecutionRouter({ request: async () => { throw new Error('offline'); }, makeAdapter: () => { throw new Error('must not instantiate'); } });
    expect(await router.resolve('unknown')).toMatchObject({ supported: false });
    expect(await router.capabilities(['unknown'])).toMatchObject([{ mode: 'discussion_unavailable' }]);
    expect(await router.resolve('xiaok-worker')).toBeNull();
  });
});
