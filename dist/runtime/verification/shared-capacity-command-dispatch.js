import { inspectSharedBlobLedgerCommand, executeSharedBlobLedgerCommand } from './shared-blob-capacity.js';
export function inspectSharedCapacityCommand(command, ledger, database) { const facts = inspectSharedBlobLedgerCommand(command, ledger, database); if (!facts)
    throw Error('shared_capacity_command_brand'); return facts; }
export function executeSharedCapacityCommand(command, context) { if (!executeSharedBlobLedgerCommand(command, context))
    throw Error('shared_capacity_command_brand'); }
