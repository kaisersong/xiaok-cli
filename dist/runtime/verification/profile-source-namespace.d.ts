import type { ProfileSourceDescriptor } from './profile-source-descriptor.js';
type Source = ProfileSourceDescriptor extends infer T ? T extends ProfileSourceDescriptor ? Omit<T, 'namespaceId' | 'reviewedSnapshotSha256'> : never : never;
/** Fixed original producer namespaces. This validates semantics only; it never
 * proves inventory completeness, physical identity, custody or approval. */
export declare function assertProfileSourceNamespace(source: Source): void;
/** Declared descendants cannot replace original fixed producer namespaces. */
export declare function assertProfileReferenceNamespace(parent: Source, relativePath: string, target: Source, physicalSuffix?: string): void;
export {};
