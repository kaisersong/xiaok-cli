import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import * as ledgerModule from '../../../src/runtime/verification/shared-capacity-ledger.js';

it.each(['reservation','replacement'] as const)('rejects the original %s callback COMMIT entry on the actual installed owner without changing existing charges',async entry=>{
 const spy=vi.spyOn(ledgerModule,'createSharedCapacityLedger');
 const f=await verifiedOperationFixture('dispatch');
 try{
  const ledger=spy.mock.results.at(-1)!.value as ReturnType<typeof ledgerModule.createSharedCapacityLedger>;
  const before=f.database.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').all();
  expect(before.length).toBeGreaterThan(0);
  const usage=ledger.usage();let calls=0,reads=0;
  const request=new Proxy({}, {get(){reads++;throw Error('request getter executed');},ownKeys(){reads++;throw Error('request trap executed');}});
  const work=()=>{calls++;f.database.exec("UPDATE shared_capacity_reservations SET state='released',revision=revision+1; COMMIT");};
  if(entry==='reservation')expect(()=>Reflect.apply(Reflect.get(ledger,'reserveWithCommit'),ledger,[{},request,work])).toThrow();
  else expect(()=>Reflect.apply(ledger.prepareMetadataReplacement,ledger,[request,work])).toThrow('shared_capacity_replacement_arguments');
  expect({calls,reads}).toEqual({calls:0,reads:0});
  expect(f.database.inTransaction).toBe(false);
  expect(f.database.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').all()).toEqual(before);
  expect(ledger.usage()).toEqual(usage);
  for(const table of ['shared_metadata_replacements','shared_metadata_replacement_claims','shared_metadata_replacement_resource_claims'])expect(f.database.prepare('SELECT * FROM '+table).all()).toEqual([]);
 }finally{spy.mockRestore();await f.close();}
});
