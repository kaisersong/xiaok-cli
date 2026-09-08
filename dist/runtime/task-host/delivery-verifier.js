import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { evaluateArtifactEvidenceGuardAsync } from '../guards/artifact-evidence-guard.js';
import { buildDeliveryFactsV1, DELIVERY_INPUT_LIMIT, DELIVERY_OUTPUT_LIMIT, DeliveryVerificationError, encodeDeliveryFrame, parseDeliveryFrame, validateDeliveryResponse, } from './delivery-facts.js';
export { buildDeliveryFactsV1 } from './delivery-facts.js';
/** A host owns one instance; attempts survive outward failure until physical drain. */
export class DeliveryVerifier {
    attempts = new Set();
    verify(snapshot, options) {
        if (this.attempts.size >= 2)
            return Promise.reject(new DeliveryVerificationError('verifier_capacity'));
        if (options.signal.aborted)
            return Promise.reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (!Number.isFinite(options.deadline) || performance.now() >= options.deadline)
            return Promise.reject(new DeliveryVerificationError('delivery_timeout'));
        let request;
        let worker;
        try {
            request = buildDeliveryFactsV1(snapshot, randomUUID());
        }
        catch (error) {
            return Promise.reject(protocolError(error, true));
        }
        if (options.signal.aborted)
            return Promise.reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (performance.now() >= options.deadline)
            return Promise.reject(new DeliveryVerificationError('delivery_timeout'));
        try {
            worker = new Worker(new URL('./delivery-verifier-worker.js', import.meta.url), { stdout: true, stderr: true });
        }
        catch {
            return Promise.reject(new DeliveryVerificationError('verifier_start_failed'));
        }
        const attempt = {};
        this.attempts.add(attempt);
        const controller = new AbortController();
        let exited = false;
        let pipelineDone = false;
        let settled = false;
        let terminated = false;
        let failure;
        let failed = false;
        let frames = 0;
        let response;
        const pending = new Set();
        const seen = new WeakSet();
        let deadlineTimer;
        let graceTimer;
        let resolve;
        let reject;
        const outcome = new Promise((yes, no) => { resolve = yes; reject = no; });
        let resolveDrained;
        const physicalDrain = new Promise(done => { resolveDrained = done; });
        const stopWatching = () => {
            clearTimeout(deadlineTimer);
            clearTimeout(graceTimer);
            options.signal.removeEventListener('abort', parentAborted);
        };
        const rejectOnce = () => {
            if (!settled) {
                settled = true;
                stopWatching();
                reject(failure);
            }
        };
        const drain = () => {
            if (!exited || !pipelineDone || pending.size > 0)
                return;
            this.attempts.delete(attempt);
            resolveDrained();
            if (failed)
                rejectOnce();
        };
        const terminateOnce = () => {
            if (terminated || exited)
                return;
            terminated = true;
            // Its Promise is not a physical-exit receipt. Only 'exit' changes exited.
            try {
                void worker.terminate().catch(() => undefined);
            }
            catch { /* retain owner */ }
        };
        const fail = (error) => {
            if (!failed) {
                failed = true;
                failure = error;
                controller.abort(error);
                clearTimeout(deadlineTimer);
                // One attempt-wide grace, not a renewed wait for each cleanup operation.
                graceTimer = setTimeout(rejectOnce, 500);
            }
            terminateOnce();
            drain();
        };
        const checkDeadline = () => {
            if (performance.now() >= options.deadline)
                fail(new DeliveryVerificationError('delivery_timeout'));
            return !failed;
        };
        const armDeadline = () => {
            if (failed || settled)
                return;
            const remaining = options.deadline - performance.now();
            if (remaining <= 0) {
                fail(new DeliveryVerificationError('delivery_timeout'));
                return;
            }
            // Native timers can run before a fractional monotonic deadline. Keep the
            // original absolute deadline, and never overflow Node's timer span.
            deadlineTimer = setTimeout(armDeadline, Math.min(2 ** 31 - 1, Math.max(1, Math.ceil(remaining))));
        };
        const parentAborted = () => fail(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        const trackPending = (raw) => {
            if (seen.has(raw))
                return;
            seen.add(raw);
            pending.add(raw);
            // Attach owner accounting before handing the exact SDK Promise to the host.
            void raw.then(() => { pending.delete(raw); drain(); }, () => { pending.delete(raw); drain(); });
            try {
                options.trackPending(raw);
            }
            catch (error) {
                fail(error);
            }
        };
        const evaluate = async (facts) => {
            try {
                if (!checkDeadline())
                    return;
                const guard = !facts.planComplete || options.artifactEvidence === false || facts.guard.kind === 'skip' ? undefined : await evaluateArtifactEvidenceGuardAsync({
                    taskId: request.taskId, status: 'completed', expectation: facts.guard.expectation, evidence: facts.guard.evidence,
                }, { signal: controller.signal, trackPending, assertActive: () => { if (!checkDeadline())
                        throw failure; } });
                if (!checkDeadline())
                    return;
                if (!settled) {
                    settled = true;
                    stopWatching();
                    resolve({ planComplete: facts.planComplete, emptyDelivery: facts.emptyDelivery, guard });
                }
            }
            catch (error) {
                fail(error);
            }
            finally {
                pipelineDone = true;
                drain();
            }
        };
        worker.on('message', (frame) => {
            if (++frames !== 1) {
                fail(new DeliveryVerificationError('verifier_protocol_error'));
                return;
            }
            if (failed || !checkDeadline())
                return;
            try {
                const value = parseDeliveryFrame(frame, DELIVERY_OUTPUT_LIMIT);
                validateDeliveryResponse(value, request);
                response = value;
                if (value.result.kind === 'error')
                    fail(protocolError(new DeliveryVerificationError(value.result.code), true));
            }
            catch (error) {
                fail(protocolError(error));
            }
        });
        worker.on('error', () => fail(new DeliveryVerificationError('verifier_crashed')));
        worker.once('exit', code => {
            exited = true;
            if (!failed && checkDeadline()) {
                if (code !== 0)
                    fail(new DeliveryVerificationError('verifier_crashed'));
                else if (frames !== 1 || response?.result.kind !== 'facts')
                    fail(new DeliveryVerificationError('verifier_protocol_error'));
            }
            if (failed || response?.result.kind !== 'facts') {
                pipelineDone = true;
                drain();
            }
            else
                void evaluate(response.result);
        });
        for (const stream of [worker.stdout, worker.stderr]) {
            let bytes = 0;
            stream?.on('data', (chunk) => {
                if (stream.destroyed)
                    return;
                bytes = Math.min(2048, bytes + (typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength));
                if (bytes === 2048)
                    stream.destroy();
                fail(new DeliveryVerificationError('verifier_protocol_error'));
            });
            stream?.on('error', () => fail(new DeliveryVerificationError('verifier_protocol_error')));
        }
        options.signal.addEventListener('abort', parentAborted, { once: true });
        armDeadline();
        if (options.signal.aborted)
            parentAborted();
        worker.once('online', () => {
            if (!checkDeadline())
                return;
            try {
                worker.postMessage(encodeDeliveryFrame(request, DELIVERY_INPUT_LIMIT));
            }
            catch {
                fail(new DeliveryVerificationError('verifier_start_failed'));
            }
        });
        // This is not outcome/terminate(). It stays pending across the outward grace
        // until the native exit AND the entire raw-IO/close pipeline have drained.
        try {
            options.trackPending(physicalDrain);
        }
        catch (error) {
            fail(error);
        }
        return outcome;
    }
}
function protocolError(error, preserveInputInvalid = false) {
    if (error instanceof DeliveryVerificationError && (['validation_limit', 'verifier_internal_error'].includes(error.code)
        || preserveInputInvalid && error.code === 'verifier_input_invalid'))
        return error;
    return new DeliveryVerificationError('verifier_protocol_error');
}
