import {inspectDockerTransactionCommand,executeDockerTransactionCommand} from '../isolated-execution/docker-runner.js';
import type {Database} from 'better-sqlite3';
import {inspectQualificationTransactionCommand,executeQualificationTransactionCommand} from './installed-engine-qualification.js';
export interface BlobTransactionWriteContext {readonly __blobTransactionContext?:never}
export function inspectBlobTransactionCommand(command:object,budget:object,database:Database):void{
 if(inspectDockerTransactionCommand(command,budget,database))return;
 if(inspectQualificationTransactionCommand(command,budget,database))return;
 throw Error('blob_transaction_command_brand');
}
export function executeBlobTransactionCommand(command:object,context:BlobTransactionWriteContext):void{
 if(executeDockerTransactionCommand(command,context))return;
 if(executeQualificationTransactionCommand(command,context))return;
 throw Error('blob_transaction_command_brand');
}
