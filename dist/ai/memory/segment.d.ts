/**
 * Point a path at app.asar.unpacked instead of app.asar.
 *
 * Electron patches `fs` so JS reads inside app.asar work, but cppjieba opens
 * its dictionaries with C++ ifstream, which bypasses that patch. electron-builder
 * unpacks native modules to app.asar.unpacked while `__dirname` still reports the
 * app.asar path, so the path has to be rewritten explicitly.
 */
export declare function rewriteAsarPath(filePath: string): string;
/**
 * Resolve every dictionary to a path that is readable from JS, or null when
 * nodejieba is not installed.
 */
export declare function resolveJiebaDictPaths(): Record<string, string> | null;
/**
 * Whether Chinese segmentation can actually run.
 *
 * Requiring nodejieba is not enough: dictionary loading is lazy, so a require
 * succeeds even when the dictionaries are unreachable, and the first cut() would
 * then abort the process from C++. This probes readability from JS first.
 */
export declare function segmentationAvailable(): boolean;
/**
 * Segment Chinese text for FTS indexing and querying.
 * Splits into Chinese / non-Chinese segments. Only Chinese segments go
 * through jieba; English words are preserved intact so FTS can match them.
 */
export declare function segmentChinese(text: string): string;
/**
 * Segment a query string using the same tokenizer used for indexing.
 * MUST match the segmentation applied during INSERT for BM25 recall.
 */
export declare function segmentQuery(query: string): string;
