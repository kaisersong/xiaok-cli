export interface OnnxEmbeddingResult {
    engine: 'onnx';
    dimensions: number;
}
export interface OnnxEmbeddingFail {
    engine: 'none';
    dimensions: 0;
}
export type OnnxStatus = OnnxEmbeddingResult | OnnxEmbeddingFail;
export declare class OnnxEmbeddingEngine {
    private session;
    private tokenizer;
    private readonly modelDir;
    private initPromise;
    constructor(modelId?: string);
    init(): Promise<OnnxStatus>;
    private _init;
    embed(texts: string[]): Promise<Float32Array[]>;
    private meanPool;
    close(): Promise<void>;
}
