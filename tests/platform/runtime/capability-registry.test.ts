import { describe, expect, it } from 'vitest';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('CapabilityRegistry', () => {
  it('returns the same capability for discovery and executable lookup', () => {
    const registry = new CapabilityRegistry();
    registry.register({
      kind: 'skill',
      name: 'cognitive-coach',
      description: 'think deeper',
      execute: async () => 'ok',
    });

    expect(registry.search('cognitive').map((entry) => entry.name)).toEqual(['cognitive-coach']);
    expect(registry.get('cognitive-coach')).toMatchObject({ kind: 'skill' });
  });
});


it('restores the whole owner discovery snapshot and rejects invalid refresh atomically',()=>{
 const registry=new CapabilityRegistry(),a={},b={},first={kind:'tool' as const,name:'read',description:'A'},second={...first,description:'B'};
 registry.register(first,a);(registry as any).register(second,b,{effect:'read'});
 expect((registry as any).getDiscovery('read')).toEqual({coreRecord:second,metadata:{effect:'read'}});
 expect(()=> (registry as any).register(first,a,{effect:'bad'})).toThrow();expect(registry.get('read')).toBe(second);
 registry.unregisterOwner(b);expect((registry as any).getDiscovery('read')).toEqual({coreRecord:first});
});
