import type { LocaleStrings } from '../locales';

/** IPC errors may be wrapped by Electron; never display raw service diagnostics. */
export function threadDeletionError(error: unknown, labels: Pick<LocaleStrings,
  'deleteThreadPending' | 'deleteThreadUnknown' | 'deleteThreadUnavailable' | 'deleteThreadFailed'>): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('thread_deletion_pending')) return labels.deleteThreadPending;
  if (message.includes('thread_deletion_unknown')) return labels.deleteThreadUnknown;
  if (message.includes('thread_deletion_unavailable') || message.includes('multi_agent_unsupported_runner')) return labels.deleteThreadUnavailable;
  return labels.deleteThreadFailed;
}
