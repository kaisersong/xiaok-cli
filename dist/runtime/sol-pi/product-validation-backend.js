import { isDeepStrictEqual } from 'node:util';
import { realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { consumeProductValidationMaterials } from '../verification/product-material-authorization.js';
/** Wiring only: obtain client from the fixed installed controller factory and
 * probe actual qualification before enabling the registry. No qualification is minted here. */
export function createProductValidationBackend(options) {
    const root = realpathSync(options.workspaceRoot), { client, expiresAt } = options;
    async function prepare(request, signal) {
        options.assertCurrent();
        signal?.throwIfAborted();
        const snapshot = structuredClone(request);
        const cwd = realpathSync(resolve(root, snapshot.command.workdir)), rel = relative(root, cwd);
        if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
            throw Error('validation_material_command_outside_workspace');
        const operationExpiresAt = Math.min(expiresAt, Date.now() + 15 * 60 * 1000), command = { argv: ['/bin/sh', '-c', snapshot.command.command], cwdRelative: rel.split(sep).join('/') || '.' };
        const authorized = await options.authorize({ workspaceRoot: root, operation: { purpose: snapshot.purpose, invocation: snapshot.invocation, exactCommand: command, ...(snapshot.editedFile ? { editedFile: snapshot.editedFile } : {}), expiresAt: operationExpiresAt }, client: client.materialAuthorization, signal, assertCurrent: options.assertCurrent });
        options.assertCurrent();
        signal?.throwIfAborted();
        if (!authorized)
            throw Error('validation_material_user_cancelled');
        const prepared = consumeProductValidationMaterials(authorized, { purpose: snapshot.purpose, invocation: snapshot.invocation, exactCommand: command, ...(snapshot.editedFile ? { editedFile: snapshot.editedFile } : {}) });
        if (Date.now() >= operationExpiresAt || !isDeepStrictEqual(prepared.invocation, snapshot.invocation) || !isDeepStrictEqual(prepared.command, command))
            throw Error('validation_material_authorization_mismatch');
        const materializedInput = client.wrapPreparedValidationInput(prepared);
        return { materializedInput, command: prepared.command, scopeDigest: prepared.scopeDigest };
    }
    return Object.freeze({ execution: client.execution,
        prepareValidationInput(input) {
            return prepare({ purpose: 'isolated-validation', invocation: { sessionIdentity: input.sessionIdentity, compoundOperationId: input.compoundOperationId, validationInvocationId: input.validationInvocationId }, editedFile: { path: input.editedFile.path, afterHash: input.editedFile.afterHash }, command: input.command }, input.signal);
        },
        prepareDirectInput(input) {
            return prepare({ purpose: 'isolated-command', invocation: { sessionIdentity: input.sessionIdentity, compoundOperationId: input.operationId, validationInvocationId: input.validationInvocationId }, command: input.command }, input.signal);
        },
    });
}
