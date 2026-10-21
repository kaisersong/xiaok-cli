import type {Database} from 'better-sqlite3';
import type {CapacityRecord} from '../../src/runtime/verification/shared-capacity-ledger.js';
export function createPrimitiveWorkerAuthority(options:{database:Database;authorityId:string;host:{assertCurrent():unknown;inspectOwner(binding:object):{sessionKey:string;producerKey:string};assertReleased(receipt:object,record:Readonly<CapacityRecord>):unknown}}):object;
