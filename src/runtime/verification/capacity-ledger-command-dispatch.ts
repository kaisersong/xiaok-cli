import type {Database} from 'better-sqlite3';
import {inspectMetadataPrepareCommand,executeMetadataPrepareCommand} from './controller-metadata-capacity.js';
import {inspectMetadataArchivePrepareCommand,executeMetadataArchivePrepareCommand} from './installed-metadata-target-prepare.js';
export interface MetadataWriteContext {readonly __metadataWriteContext?:never}
export function inspectCapacityMetadataCommand(command:object,ledger:object,database:Database){const facts=inspectMetadataPrepareCommand(command,ledger,database)??inspectMetadataArchivePrepareCommand(command,ledger,database);if(!facts)throw Error('capacity_metadata_command_brand');return facts;}
export function executeCapacityMetadataCommand(command:object,context:MetadataWriteContext):void{if(!executeMetadataPrepareCommand(command,context)&&!executeMetadataArchivePrepareCommand(command,context))throw Error('capacity_metadata_command_brand');}
