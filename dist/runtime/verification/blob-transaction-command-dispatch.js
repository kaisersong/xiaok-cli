import { inspectDockerTransactionCommand, executeDockerTransactionCommand } from '../isolated-execution/docker-runner.js';
import { inspectQualificationTransactionCommand, executeQualificationTransactionCommand } from './installed-engine-qualification.js';
export function inspectBlobTransactionCommand(command, budget, database) {
    if (inspectDockerTransactionCommand(command, budget, database))
        return;
    if (inspectQualificationTransactionCommand(command, budget, database))
        return;
    throw Error('blob_transaction_command_brand');
}
export function executeBlobTransactionCommand(command, context) {
    if (executeDockerTransactionCommand(command, context))
        return;
    if (executeQualificationTransactionCommand(command, context))
        return;
    throw Error('blob_transaction_command_brand');
}
