export type OfficeFormat = 'doc' | 'docx' | 'docm' | 'ppt' | 'pps' | 'pot' | 'pptx' | 'pptm' | 'ppsx' | 'ppsm' | 'xls' | 'xlsx' | 'xlsm' | 'xlsb';
export declare const OFFICE_FORMATS: ReadonlyMap<OfficeFormat, string>;
export declare const OFFICE_EXTENSIONS: ReadonlySet<string>;
export declare const OOXML_FALLBACK_EXTENSIONS: ReadonlySet<string>;
export declare function officeFormatForPath(pathOrExtension: string): OfficeFormat | undefined;
export declare function isOfficeDocument(pathOrExtension: string): boolean;
export declare function getDocumentMimeType(pathOrExtension: string): string | undefined;
export declare function extensionFromPathLike(pathOrExtension: string): string;
