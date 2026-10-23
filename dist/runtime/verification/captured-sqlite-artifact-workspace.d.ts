import type { ArtifactWorkspaceSourceEvent as Event } from './artifact-workspace-source-types.js';
/** All rows still present in every matching held source. Events are declarations;
 * only full iteration yields complete, and even complete grants no authority. */
export declare function iterateCapturedSQLiteArtifactWorkspaceSources(owner: object, token: object): Generator<Event, void, unknown>;
