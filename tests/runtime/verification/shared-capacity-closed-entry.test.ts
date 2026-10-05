import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as ledgerModule from '../../../src/runtime/verification/shared-capacity-ledger.js';
import * as sharedModule from '../../../src/runtime/verification/installed-shared-capacity.js';
it('exposes fixed actual shared capacity commands without a public transaction callback sibling',async()=>{
 const ledgerSpy=vi.spyOn(ledgerModule,'createSharedCapacityLedger'),spy=vi.spyOn(sharedModule,'createInstalledSharedCapacity');const f=await installedControllerFixture();
 try{const actual=spy.mock.results.at(-1)!.value as ReturnType<typeof sharedModule.createInstalledSharedCapacity>;expect(actual.budget).not.toHaveProperty('withReservationTransaction');expect(actual.capacity).not.toHaveProperty('withReservationTransaction');expect(actual.capacity).not.toHaveProperty('reserveWithCommit');expect(actual.capacity).not.toHaveProperty('reserveBatchWithCommit');expect(actual.capacity).not.toHaveProperty('releaseWithCommit');const ledger=ledgerSpy.mock.results.at(-1)!.value as ReturnType<typeof ledgerModule.createSharedCapacityLedger>;for(const name of ['reserveWithCommit','releaseWithCommit','withReservationTransaction','importReservations'])expect(ledger).not.toHaveProperty(name);let called=0;for(const command of [()=>{called++;},{kind:'transaction'},Object.freeze({})])expect(()=>ledger.reserveCommand(command)).toThrow('shared_capacity_command_brand');expect(called).toBe(0);}
 finally{ledgerSpy.mockRestore();spy.mockRestore();await f.close();}
});
