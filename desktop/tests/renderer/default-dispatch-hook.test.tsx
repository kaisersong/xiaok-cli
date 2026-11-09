import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useKSwarmClient} from '../../renderer/src/hooks/useKSwarmClient';
afterEach(()=>{cleanup();delete (window as any).xiaokDesktop;vi.restoreAllMocks();});
function setup(capture?:ReturnType<typeof vi.fn>){
 const post=vi.fn(),get=vi.fn().mockResolvedValue({projects:[]});
 (window as any).xiaokDesktop={captureDefaultDispatchOperation:capture,kswarmProxyGet:get,kswarmProxyPost:post,kswarmStreamSubscribe:vi.fn().mockResolvedValue({ok:true}),kswarmStreamUnsubscribe:vi.fn().mockResolvedValue({ok:true}),onKSwarmConnectionStatus:vi.fn().mockReturnValue(()=>{}),onKSwarmWsEvent:vi.fn().mockReturnValue(()=>{})};
 return{post,...renderHook(()=>useKSwarmClient())};
}
it('passes only project identity to the semantic preload API and preserves its receipt',async()=>{
 const receipt={ok:true,operation:{children:[{state:'intent_pending'}]},preparationObservations:[{childKey:'original-child',taskId:'task',status:'present'}]},capture=vi.fn().mockResolvedValue(receipt),f=setup(capture);let actual:unknown;
 await act(async()=>{actual=await f.result.current.dispatchTasks('p');});
 expect(actual).toBe(receipt);expect(capture).toHaveBeenCalledWith({projectId:'p'});expect(f.post).not.toHaveBeenCalled();
});
it('returns unavailable when the semantic API is absent and never falls back to generic dispatch',async()=>{
 const f=setup();let actual:unknown;await act(async()=>{actual=await f.result.current.dispatchTasks('p');});
 expect(actual).toEqual({ok:false,error:'DEFAULT_DISPATCH_UNAVAILABLE'});expect(f.post).not.toHaveBeenCalled();
});
it('preserves an original semantic rejection without a fallback write',async()=>{
 const error=Error('original delivery unknown'),capture=vi.fn().mockRejectedValue(error),f=setup(capture);let actual:unknown;
 await act(async()=>{try{await f.result.current.dispatchTasks('p');}catch(e){actual=e;}});
 expect(actual).toBe(error);expect(f.post).not.toHaveBeenCalled();
});
