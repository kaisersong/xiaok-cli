/** Fixed archive methods. Delete requires its own native action and one-use handle. */
export declare const ARCHIVE_METHODS: readonly ["archive.list", "archive.prepare", "archive.authorize", "archive.read", "archive.delete", "archive.close"];
export type ArchiveMethod = typeof ARCHIVE_METHODS[number];
export interface AuthenticatedArchiveTransport {
    call(method: ArchiveMethod, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}
