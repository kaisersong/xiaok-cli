import type { readProfileSqliteReaderSchema } from './profile-source-capture.js';
export declare function readCapturedGroupsSchema(actual: ReturnType<typeof readProfileSqliteReaderSchema>, version: number): Readonly<{
    version: 1 | 2 | 3;
    tables: readonly string[];
    threadQuery: 'groups:thread_bindings' | 'groups:thread_bindings-v1-0' | 'groups:thread_bindings-v1-1' | 'groups:thread_bindings-v1-2';
}>;
