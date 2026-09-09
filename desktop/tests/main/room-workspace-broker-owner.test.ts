import { describe, expect, it, vi } from 'vitest';
import { recoverOwnedBrokerAuthentication } from '../../electron/kswarm-service.js';

describe('healthy broker with incompatible authentication is not an ownership proof',()=>{
  it('preserves unknown external broker without invoking termination',async()=>{
    const stopOwned=vi.fn(async()=>{});const findOwner=vi.fn(async()=>1234);
    expect(await recoverOwnedBrokerAuthentication({ownedPid:null,findOwner,stopOwned})).toBe('external');
    expect(stopOwned).not.toHaveBeenCalled();expect(findOwner).not.toHaveBeenCalled();
  });
  it('does not terminate when port was taken by a different process',async()=>{
    const stopOwned=vi.fn(async()=>{});
    expect(await recoverOwnedBrokerAuthentication({ownedPid:1234,findOwner:async()=>5678,stopOwned})).toBe('external');
    expect(stopOwned).not.toHaveBeenCalled();
  });
  it('recovers the actual owned child using its scoped stop operation',async()=>{
    const stopOwned=vi.fn(async()=>{});
    expect(await recoverOwnedBrokerAuthentication({ownedPid:1234,findOwner:async()=>1234,stopOwned})).toBe('stopped');
    expect(stopOwned).toHaveBeenCalledTimes(1);
  });
});
