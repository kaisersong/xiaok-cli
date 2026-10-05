import type { NativeSnapshot } from '../task-host/codex-native-types.js';
import type { ProfileSourceDirectory } from './profile-source-descriptor.js';
interface NativeRow {
    id: string;
    owner: string;
    nativeId: string | null;
    snapshot: NativeSnapshot;
}
interface CodexSource {
    sourceId: string;
    snapshotHash: string;
    nativeSessions: NativeRow[];
    settings: Array<{
        key: 'selected';
        value: 'true' | 'false';
    }>;
    threads: Array<{
        threadId: string;
        nativeId: string;
    }>;
    routes: Array<{
        taskId: string;
        threadId: string;
        threadPresent: boolean;
    }>;
}
interface Pair {
    routesSourceId: string;
    nativeSourceId: string | null;
    directory: Readonly<ProfileSourceDirectory>;
    state: 'paired' | 'native-source-absent';
}
/** Complete known-format statements from a single actual full capture. Neither
 * ordinary owner strings nor external persisted IDs grant native authority. */
export declare function readCapturedSQLiteCodexSources(owner: object, token: object): Readonly<{
    kind: "captured-sqlite-codex-declarations";
    sources: CodexSource[];
    pairs: Pair[];
}>;
export {};
