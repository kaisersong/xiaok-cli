/** Public wire contract; filesystem and authorization remain owned by main. */
export interface FilePathInput {
    filePath: string;
}
export interface SaveFileInput extends FilePathInput {
    content: string;
    purpose?: 'html-edit' | 'text-edit';
}
export type OpenFileResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
export interface ReadFileResult {
    content: string;
    error?: string;
}
export interface SaveFileResult {
    success: boolean;
    error?: string;
    ok?: boolean;
}
