import { inspectMetadataPrepareCommand, executeMetadataPrepareCommand } from './controller-metadata-capacity.js';
import { inspectMetadataArchivePrepareCommand, executeMetadataArchivePrepareCommand } from './installed-metadata-target-prepare.js';
export function inspectCapacityMetadataCommand(command, ledger, database) { const facts = inspectMetadataPrepareCommand(command, ledger, database) ?? inspectMetadataArchivePrepareCommand(command, ledger, database); if (!facts)
    throw Error('capacity_metadata_command_brand'); return facts; }
export function executeCapacityMetadataCommand(command, context) { if (!executeMetadataPrepareCommand(command, context) && !executeMetadataArchivePrepareCommand(command, context))
    throw Error('capacity_metadata_command_brand'); }
