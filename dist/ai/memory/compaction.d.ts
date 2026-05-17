import Database from 'better-sqlite3';
export interface L1CompactionResult {
    extracted: number;
}
export interface L2CompactionResult {
    scenarios: number;
}
export interface L3CompactionResult {
    traits: number;
}
export interface CompactL0Options {
    sessionId?: string;
    minMessages?: number;
    maxPromptTokens?: number;
}
type LLMFn = (prompt: string) => Promise<string>;
export declare function compactL0toL1(db: Database.Database, llm: LLMFn, options?: CompactL0Options): Promise<L1CompactionResult>;
export declare function compactL1toL2(db: Database.Database, llm: LLMFn): Promise<L2CompactionResult>;
export declare function compactL2toL3(db: Database.Database, llm: LLMFn): Promise<L3CompactionResult>;
export {};
