/** Fixed archive methods. Delete requires its own native action and one-use handle. */
export const ARCHIVE_METHODS = ['archive.list', 'archive.prepare', 'archive.authorize', 'archive.read', 'archive.delete', 'archive.close'] as const;
export type ArchiveMethod = typeof ARCHIVE_METHODS[number];
export interface AuthenticatedArchiveTransport {
  call(method: ArchiveMethod, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}
