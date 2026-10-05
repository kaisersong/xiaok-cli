import type {Database} from 'better-sqlite3';
import {inspectSharedBlobLedgerCommand,executeSharedBlobLedgerCommand} from './shared-blob-capacity.js';
export interface SharedCapacityWriteContext {readonly __sharedCapacityWriteContext?:never}
export function inspectSharedCapacityCommand(command:object,ledger:object,database:Database){const facts=inspectSharedBlobLedgerCommand(command,ledger,database);if(!facts)throw Error('shared_capacity_command_brand');return facts;}
export function executeSharedCapacityCommand(command:object,context:SharedCapacityWriteContext):void{if(!executeSharedBlobLedgerCommand(command,context))throw Error('shared_capacity_command_brand');}
