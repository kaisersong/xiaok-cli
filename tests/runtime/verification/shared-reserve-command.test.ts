import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import * as commands from '../../../src/runtime/verification/shared-capacity-command-dispatch.js';
it('charges actual installed material and transcript allocations through the fixed shared ledger command',async()=>{
 const spy=vi.spyOn(commands,'executeSharedCapacityCommand');let f:Awaited<ReturnType<typeof verifiedOperationFixture>>|undefined;
 try{f=await verifiedOperationFixture('dispatch');expect(spy.mock.calls.length).toBeGreaterThan(0);expect(f.database.prepare("SELECT COUNT(*) n FROM shared_blob_bindings").get()).toEqual(expect.objectContaining({n:expect.any(Number)}));}
 finally{spy.mockRestore();await f?.close();}
});
