import type { ProfileSourceReview } from './profile-source-review.js';
import type { ProfileCaptureFacts } from './profile-source-capture.js';
import type { DirectorySourceEntry } from './source-directory-process.js';
import type { SqliteSourceCapture } from './source-sqlite-process.js';
export interface ProfileCaptureTransfer {
    readonly facts: Readonly<ProfileCaptureFacts>;
    readonly directories: readonly Readonly<{
        sourceId: string;
        entries: readonly Readonly<DirectorySourceEntry>[];
    }>[];
    readonly databases: readonly Readonly<{
        sourceId: string;
        capture: Readonly<SqliteSourceCapture>;
    }>[];
}
/** Strict transfer decoder only. Passing it plain bytes never creates a capture
 * brand; only the installed factory can fetch the original broker handle. */
export declare function parseProfileCaptureTransfer(bytes: Buffer, review: Readonly<ProfileSourceReview>): Readonly<ProfileCaptureTransfer>;
