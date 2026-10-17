/** Complete historical Loop/Completion/scanner declarations. Production callers
 * consume the stream to its final complete event; this module deliberately has
 * no all-source body/JSON aggregation API and grants no native authority. */
export { iterateCapturedSQLiteLoopSources } from './captured-sqlite-loop-stream.js';
export type { CapturedLoopStreamEvent } from './captured-sqlite-loop-stream.js';
