import { readCapturedFileSession, parseSessionDeletionJournal } from '../../ai/runtime/session-store/file-store.js';
import { type SessionAliasBinding, type SessionAliasRow } from '../../ai/runtime/session-store/aliases.js';
import { captureMigrationMarker } from '../../ai/runtime/session-store/migration.js';
import { readCapturedGoalSessions } from '../goal/file-store.js';
import { parseGoalNativeJournalDocument } from '../goal/native-mutation-journal.js';
import { readCapturedTaskDeclarations } from '../task-host/snapshot-store.js';
import { parseOrdinaryProfileSources } from './ordinary-profile-source-registry.js';
import { readProfileSourceCapture, readProfileDirectoryEntries } from './profile-source-capture.js';
type Source = ReturnType<typeof readProfileSourceCapture>['sources'][number];
type TaskDeclaration = ReturnType<typeof readCapturedTaskDeclarations>;
type SessionDeclaration = ReturnType<typeof readCapturedFileSession>;
type FileSourceFacts = {
    sourceId: string;
    snapshotHash: string;
    kind: Source['source']['kind'];
    directory: string;
    entries: ReturnType<typeof readProfileDirectoryEntries>;
    sessions: SessionDeclaration[];
    migrations: ReturnType<typeof captureMigrationMarker>[];
    deletions: ReturnType<typeof parseSessionDeletionJournal>[];
    tasks: TaskDeclaration[];
    goals: ReturnType<typeof readCapturedGoalSessions>[];
    nativeGoals: Array<{
        sessionId: string;
        records: ReturnType<typeof parseGoalNativeJournalDocument>;
    }>;
    aliases: SessionAliasRow[];
    activeTaskIds: string[];
    lastSessionReference: string | null;
    registry: ReturnType<typeof parseOrdinaryProfileSources> | null;
    sourceReferences: Array<{
        path: string;
        sourceId: string;
        sessionIdentities: string[];
        unresolved: boolean;
    }>;
};
/** Complete file-source statements from an existing all-source capture. This
 * synchronous reader performs no source IO, repair, native enrollment or grant. */
export declare function readCapturedFileSources(owner: object, token: object): Readonly<{
    kind: "captured-file-source-declarations";
    sources: FileSourceFacts[];
    aliases: {
        canonicalSourceId: string;
        state: SessionAliasRow["state"];
        binding: SessionAliasBinding;
        marker: {
            sourceId: string;
            path: string;
        } | null;
        target: "present" | "missing";
        unresolvedReasons: string[];
    }[];
    observationSides: {
        taskSourceId: string;
        sessionSourceId: string | null;
        sessionIdentity: string;
        taskIds: string[];
        state: string;
        missingReasons: string[];
    }[];
    historicalPointers: {
        sourceId: string;
        sessionIdentity: string;
        present: boolean;
    }[];
}>;
export {};
