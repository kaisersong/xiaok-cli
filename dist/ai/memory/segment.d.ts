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
