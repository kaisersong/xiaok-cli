/** Main-only settlement for one model request. Never an IPC or tool value. */
export interface DesktopModelUsageAdmission {
  commit(inputTokens: number, outputTokens: number): Promise<void>;
  revoke(): void;
}

/** Compose the original service command P with this request's journal/statistics.
 * The returned memoized C includes both operations; it is not a receipt for P. */
export function mapDesktopModelUsageAdmission(
  original: DesktopModelUsageAdmission,
  afterCommit: (inputTokens: number, outputTokens: number) => void | Promise<void>,
): DesktopModelUsageAdmission {
  try {
    if (typeof original.commit !== 'function' || typeof original.revoke !== 'function'
      || typeof afterCommit !== 'function') throw Error('desktop_model_usage_admission_invalid');
    const commitOriginal = original.commit;
    const revokeOriginal = original.revoke;
    let open = true;
    let memo: { inputTokens: number; outputTokens: number; promise: Promise<void> } | undefined;
    const admission: DesktopModelUsageAdmission = {
      commit(inputTokens, outputTokens) {
        if (this !== admission) throw Error('desktop_model_usage_admission_invalid');
        if (!open) throw Error('desktop_model_usage_admission_revoked');
        if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
          || !Number.isSafeInteger(outputTokens) || outputTokens < 0) throw Error('invalid usage');
        if (memo) {
          if (memo.inputTokens !== inputTokens || memo.outputTokens !== outputTokens) throw Error('usage_id_conflict');
          return memo.promise;
        }
        // Publish C and its payload before invoking P or any journal callback.
        const promise = Promise.resolve().then(() => commitOriginal.call(original, inputTokens, outputTokens))
          .then(() => afterCommit(inputTokens, outputTokens));
        memo = { inputTokens, outputTokens, promise };
        return promise;
      },
      revoke() {
        if (this !== admission) throw Error('desktop_model_usage_admission_invalid');
        if (!open) return;
        open = false;
        revokeOriginal.call(original);
      },
    };
    return Object.freeze(admission);
  } catch (error) {
    // A legitimate original revoke is pure memory. Preserve both originals if
    // an invalid wrapper unexpectedly makes that cleanup fail as well.
    try { original.revoke(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'desktop_model_usage_admission_map_cleanup_failed', { cause: error });
    }
    throw error;
  }
}
