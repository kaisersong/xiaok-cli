import { inspectMetadataPrepareCommand, executeMetadataPrepareCommand } from './controller-metadata-capacity.js';
export function inspectCapacityMetadataCommand(command, ledger, database) { const facts = inspectMetadataPrepareCommand(command, ledger, database); if (!facts)
    throw Error('capacity_metadata_command_brand'); return facts; }
export function executeCapacityMetadataCommand(command, context) { if (!executeMetadataPrepareCommand(command, context))
    throw Error('capacity_metadata_command_brand'); }
