import { observeInstalledCompletion } from '../verification/installed-completion-observation.js';
import { executeOriginalCompletionFileEffect } from './original-completion-file-io.js';
import {
  completionEvidenceFlow,
  type CompletionEvidenceInput,
  type EvidenceEffect,
  type EvidenceEffectResult,
  type EvidenceValidationResult,
} from './completion-evidence.js';

export interface EvidenceIoOptions {
  signal: AbortSignal;
  /** Host-owned absolute-deadline check, also at IO microtask boundaries. */
  assertActive?(): void;
  /** Receives the original SDK Promise, before any continuation/abort wrapper. */
  trackPending(raw: Promise<unknown>, originalFileOperation?: object): void;
}
export function throwEvidenceAbort(signal: AbortSignal): void {
  if (signal.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
export function assertEvidenceActive(options: EvidenceIoOptions): void {
  throwEvidenceAbort(options.signal);
  options.assertActive?.();
  throwEvidenceAbort(options.signal);
}

export async function validateCompletionEvidenceAsync(
  input: CompletionEvidenceInput,
  options: EvidenceIoOptions,
): Promise<EvidenceValidationResult> {
  assertEvidenceActive(options);
  const flow = completionEvidenceFlow(input);
  let step = flow.next();
  while (!step.done) {
    assertEvidenceActive(options);
    let value: EvidenceEffectResult;
    try {
      value = await executeEffect(step.value, options);
    } catch (error) {
      // Cancellation must not enter the ordinary missing-file/fail-open catches.
      assertEvidenceActive(options);
      step = flow.throw(error);
      continue;
    }
    assertEvidenceActive(options);
    step = flow.next(value);
  }
  assertEvidenceActive(options);
  return step.value;
}

async function executeEffect(
  effect: EvidenceEffect,
  options: EvidenceIoOptions,
): Promise<EvidenceEffectResult> {
  switch (effect.kind) {
    case 'current-completion':
      return raw(
        observeInstalledCompletion(effect.owner, options.signal),
        options,
      );
    case 'lstat': {
      const symbolic = await executeOriginalCompletionFileEffect(
        effect,
        options,
      );
      return { isSymbolicLink: () => symbolic === true };
    }
    case 'exists':
    case 'realpath':
    case 'structure':
      return executeOriginalCompletionFileEffect(effect, options);
  }
}

function raw<T>(promise: Promise<T>, options: EvidenceIoOptions): Promise<T> {
  options.trackPending(promise);
  return promise;
}
