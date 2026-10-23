import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import * as operation from '../../../src/runtime/verification/approved-verification-operation.js';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
it('binds the actual operation guard to its original database owner scope and revision',async()=>{
 const observe=vi.spyOn(operation,'assertApprovedOperationScopeGuard');let f:Awaited<ReturnType<typeof verifiedOperationFixture>>|undefined;
 try{f=await verifiedOperationFixture();const original=observe.mock.calls[0];expect(original).toBeDefined();observe.mockRestore();const [guard,database,scope]=original!;
  expect(()=>operation.assertApprovedOperationScopeGuard(guard,database,scope)).not.toThrow();expect(()=>operation.assertApprovedOperationScopeGuard({...guard},database,scope)).toThrow('scope_guard_brand');expect(()=>operation.assertApprovedOperationScopeGuard(guard,{} as never,scope)).toThrow('scope_guard_binding');expect(()=>operation.assertApprovedOperationScopeGuard(guard,database,{...scope,revision:scope.revision+1})).toThrow('scope_guard_binding');expect(()=>operation.assertApprovedOperationScopeGuard(guard,database,{...scope,owner:{...scope.owner,ownerId:'other'}})).toThrow('scope_guard_binding');expect(()=>f!.composition.privateHost.authorityHost.registerScopeGuard(scope,guard)).toThrow('rebind');f.material.revoke((f.database.prepare('SELECT id FROM material_authority_challenges').get() as {id:string}).id,f.peer);expect(()=>operation.assertApprovedOperationScopeGuard(guard,database,scope)).toThrow();
 }finally{observe.mockRestore();await f?.close();}
});
