// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {contextDerivative} from '../fixtures/context-derivative.js';
import {assertOriginalDesktopCanonicalSource,readOriginalDesktopCanonicalSource} from '../../electron/desktop-services.js';
import {originalDesktopRuntimeSourceContext,DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
it('rejects caller proof DTOs and injected execution runner before reading source selection',async()=>{
 const f=await contextDerivative();try{const getter=vi.fn(()=>{throw new Error('caller source selection getter');}),ids=Object.defineProperty([],'0',{enumerable:true,get:getter});
 expect(()=>f.services.prepareCanonicalSource({} as never,ids)).toThrow(/canonical_runtime_source_unavailable/);expect(getter).not.toHaveBeenCalled();
 for(const proof of [{kind:'original-desktop-source-proof'},new Proxy({},{}),{}]){expect(()=>assertOriginalDesktopCanonicalSource(f.services,{}as never,proof)).toThrow(/canonical_runtime_source_unavailable/);expect(()=>readOriginalDesktopCanonicalSource(f.services,{}as never,proof)).toThrow(/canonical_runtime_source_unavailable/);}
 }finally{await f.close();}
});
it('uses only an original private Runtime context and closes it before a poisoned public early return',async()=>{
 const f=await contextDerivative();try{const runtime=f.services.continuity,actual=f.services.continuity.port(),context=originalDesktopRuntimeSourceContext(runtime);
 expect(context.service).toBe(actual.service);expect(context.actor).toEqual(actual.actor);expect(Object.isFrozen(context)).toBe(true);expect(Object.isFrozen(context.actor)).toBe(true);
 for(const fake of [{...runtime},new Proxy(runtime,{}),Object.assign(Object.create(DesktopContextContinuity.prototype),{current:actual})])expect(()=>originalDesktopRuntimeSourceContext(fake as DesktopContextContinuity)).toThrow(/canonical_runtime_source_unavailable/);
 const publicRuntime=runtime as unknown as Record<string,unknown>;publicRuntime.closed=true;await runtime.close();publicRuntime.closed=false;expect(()=>originalDesktopRuntimeSourceContext(runtime)).toThrow(/canonical_runtime_source_unavailable/);
 }finally{await f.close();}
});
