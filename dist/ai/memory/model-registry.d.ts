interface DownloadableFile {
    filename: string;
    url: string;
    mirror?: string;
}
export interface ModelEntry {
    id: string;
    name: string;
    dims: number;
    size: string;
    languages: string;
    downloadFiles: DownloadableFile[];
    requiredFiles: string[];
}
export declare const MODEL_REGISTRY: ModelEntry[];
export declare function getModelDir(modelId?: string): string;
export declare function isModelDownloaded(modelId?: string): boolean;
export declare function findModel(modelId: string): ModelEntry | undefined;
export declare function getManualDownloadHint(modelId: string): {
    urls: {
        file: string;
        url: string;
    }[];
    targetDir: string;
};
export declare function downloadModel(modelId: string): Promise<void>;
export {};
