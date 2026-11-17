import type {Database} from '../../src/utils/builtin-sqlite.js';
import type {CapacityRecord} from '../../src/runtime/verification/shared-capacity-ledger.js';
export function createPrimitiveWorkerAuthority(options:{database:Database;authorityId:string;host:{assertCurrent():unknown;inspectOwner(binding:object):{sessionKey:string;producerKey:string};assertReleased(receipt:object,record:Readonly<CapacityRecord>):unknown}}):object;
