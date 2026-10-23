import { beginToolObservation } from './collector-port.js';
import { truncateText } from '../../ai/tools/truncation.js';
export async function executeCompoundValidation(input) {
    const { record } = input;
    if (!record.file || record.editStatus !== 'succeeded' || record.stage !== 'edit_committed')
        throw Error('compound_validation_requires_committed_edit');
    return executeIsolatedConsumer({ ...input, identity: { sessionIdentity: record.dispatch.sessionIdentity, operationId: record.id, validationInvocationId: record.validationInvocationId },
        start: expected => input.persist({ stage: 'validation_started', physicalExecution: expected }),
        settle: (outcome, exitCode) => input.persist({ stage: 'settled', validation: { status: outcome === 'success' ? 'succeeded' : outcome === 'cancelled' ? 'cancelled' : 'failed', exitCode } }),
        unknown: () => input.persist({ stage: 'outcome_unknown' }) });
}
export async function executeDirectIsolatedCommand(input) {
    const { record } = input;
    if (record.toolName !== 'bash' || record.stage !== 'prepared')
        throw Error('compound_direct_command_not_prepared');
    return executeIsolatedConsumer({ ...input, identity: { sessionIdentity: record.dispatch.sessionIdentity, operationId: record.id, validationInvocationId: input.validationInvocationId },
        start: expected => input.persist({ stage: 'started', finalInputHash: input.finalInputHash, physicalExecution: expected }),
        settle: (outcome) => input.persist({ stage: 'settled', outcome: outcome === 'success' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed', quiescence: 'isolated_tree' }),
        unknown: () => input.persist({ stage: 'outcome_unknown', outcome: 'unknown' }) });
}
async function executeIsolatedConsumer(input) {
    const { backend, actual, context, assertCurrent, identity } = input;
    if (!Number.isFinite(actual.timeoutMs) || actual.timeoutMs <= 0 || !Number.isFinite(actual.maxChars) || actual.maxChars <= 0)
        throw Error('compound_validation_limits_invalid');
    assertCurrent();
    context?.signal?.throwIfAborted();
    const staged = input.preparedInput;
    assertCurrent();
    context?.signal?.throwIfAborted();
    // The protected staging service must bind the same final native command. The
    // consumer still checks this exact argv before any reservation can be dispatched.
    if (JSON.stringify(staged.command.argv) !== JSON.stringify(['/bin/sh', '-c', actual.command]))
        throw Error('compound_validation_command_changed');
    const reserved = await backend.execution.reserveExecution({ sessionIdentity: identity.sessionIdentity, compoundOperationId: identity.operationId,
        validationInvocationId: identity.validationInvocationId, scopeDigest: staged.scopeDigest, command: staged.command, materializedInput: staged.materializedInput, signal: context?.signal });
    const expected = structuredClone(reserved.expected);
    if (expected.sessionIdentity !== identity.sessionIdentity || expected.compoundOperationId !== identity.operationId || expected.validationInvocationId !== identity.validationInvocationId || expected.scopeDigest !== staged.scopeDigest || expected.executionIdentity !== reserved.executionIdentity)
        throw Error('compound_validation_reservation_mismatch');
    await input.start(expected);
    const abort = new AbortController();
    const signal = context?.signal ? AbortSignal.any([context.signal, abort.signal]) : abort.signal;
    let timedOut = false, truncated = false, totalBytes = 0, stdout = '', stderr = '';
    const timer = setTimeout(() => { timedOut = true; abort.abort(new DOMException('Validation timeout', 'TimeoutError')); }, actual.timeoutMs);
    const observation = beginToolObservation(context?.observationCollector, { toolName: 'bash', source: { command: actual.command, workdir: actual.workdir } });
    const append = (stream, chunk) => {
        if (typeof chunk !== 'string')
            throw Error('compound_validation_output_invalid');
        const bytes = Buffer.from(chunk), remaining = Math.max(0, 1024 * 1024 - totalBytes);
        totalBytes += bytes.length;
        if (bytes.length > remaining) {
            truncated = true;
            abort.abort(Error('compound_validation_output_limit'));
        }
        const kept = bytes.subarray(0, remaining).toString('utf8');
        observation.append(kept);
        if (stream === 'stdout')
            stdout += kept;
        else
            stderr += kept;
        context?.executionProgress?.progress();
    };
    try {
        // Native permission checks must run again immediately before the irreversible
        // dispatch. Failure after the durable started barrier remains uncertain.
        assertCurrent();
        context?.assertPermissionApproval?.();
        signal.throwIfAborted();
        const result = await backend.execution.dispatchExecution(expected, { signal, onStdout: chunk => append('stdout', chunk), onStderr: chunk => append('stderr', chunk) });
        if (result.termination !== 'terminal' || !result.receipt)
            throw Error('compound_validation_quiescence_unknown');
        backend.execution.assertQuiescent(result.receipt, expected);
        const outcome = context?.signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : result.exitCode === 0 ? 'success' : 'error';
        observation.finalize({ executionState: 'terminal', outcome, ...(truncated || result.outputTruncated ? { incompleteReason: 'collector_limit' } : outcome === 'cancelled' ? { incompleteReason: 'cancelled' } : outcome === 'timeout' ? { incompleteReason: 'timeout' } : {}) });
        await input.settle(outcome, result.exitCode);
        context?.runtimeFactSink?.emit({ invocationId: identity.validationInvocationId, toolName: 'bash', factKind: 'command_result', exitCode: result.exitCode });
        return truncateText(`${outcome === 'success' ? '' : 'Error: '}[validation ${outcome}; exitCode=${result.exitCode}]\n${stdout}${stderr ? '\n' + stderr : ''}`, actual.maxChars).text;
    }
    catch (error) {
        observation.finalize({ executionState: 'termination_pending', incompleteReason: 'termination_unconfirmed' });
        await input.unknown();
        return 'Error: validation execution outcome unknown; session mutations require trusted recovery';
    }
    finally {
        clearTimeout(timer);
    }
}
