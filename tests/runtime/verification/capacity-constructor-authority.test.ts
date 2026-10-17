import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import {createSharedCapacityLedger} from '../../../src/runtime/verification/shared-capacity-ledger.js';
import {createSharedBlobCapacity} from '../../../src/runtime/verification/shared-blob-capacity.js';
import {createAuthorityBlobBudget} from '../../../src/runtime/verification/authority-blob-budget.js';
import {createVerificationBlobBudget} from '../../../src/runtime/verification/blob-budget.js';
it.each(['ledger','shared','authority','blob'] as const)('rejects the former %s constructor callback configuration before invoking it on the actual installed DB',async kind=>{
 const f=await installedControllerFixture();let calls=0;
 try{const forbidden=()=>{calls++;throw Error('caller callback executed');},options={database:f.database,authorityId:'actual-authority',profileId:'former',assertCurrent:forbidden,deletion:{assertDeleted:forbidden},host:{assertCurrent:forbidden,inspectOwner:forbidden,assertReleased:forbidden}};
 const factory={ledger:createSharedCapacityLedger,shared:createSharedBlobCapacity,authority:createAuthorityBlobBudget,blob:createVerificationBlobBudget}[kind];
 expect(()=>Reflect.apply(factory,undefined,[options])).toThrow('capacity_authority_configuration');expect(calls).toBe(0);expect(f.database.inTransaction).toBe(false);
 }finally{await f.close();}
});
it.each(['ledger','shared','authority','blob'] as const)('rejects %s constructor proxies without executing traps',async kind=>{
 const f=await installedControllerFixture();let calls=0;
 try{const options=new Proxy({},{get(){calls++;throw Error('constructor trap');},ownKeys(){calls++;throw Error('constructor trap');},getPrototypeOf(){calls++;throw Error('constructor trap');}}),factory={ledger:createSharedCapacityLedger,shared:createSharedBlobCapacity,authority:createAuthorityBlobBudget,blob:createVerificationBlobBudget}[kind];expect(()=>Reflect.apply(factory,undefined,[options])).toThrow('capacity_authority_configuration');expect(calls).toBe(0);}
 finally{await f.close();}
});
it.each(['ledger','shared','authority','blob'] as const)('rejects %s constructor getters before reading configuration',async kind=>{
 const f=await installedControllerFixture();let calls=0;
 try{const options=Object.defineProperties({},Object.fromEntries(['database','authority','authorityId','profileId','assertCurrent','deletion','host'].map(key=>[key,{enumerable:true,get(){calls++;throw Error('constructor getter');}}]))),factory={ledger:createSharedCapacityLedger,shared:createSharedBlobCapacity,authority:createAuthorityBlobBudget,blob:createVerificationBlobBudget}[kind];expect(()=>Reflect.apply(factory,undefined,[options])).toThrow('capacity_authority_configuration');expect(calls).toBe(0);}
 finally{await f.close();}
});
