const OFFICE_FORMAT_ROWS = [
    ['doc', 'application/msword'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['ppt', 'application/vnd.ms-powerpoint'],
    ['pps', 'application/vnd.ms-powerpoint'],
    ['pot', 'application/vnd.ms-powerpoint'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
    ['ppsx', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'],
    ['ppsm', 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12'],
    ['xls', 'application/vnd.ms-excel'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['xlsb', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'],
];
export const OFFICE_FORMATS = new Map(OFFICE_FORMAT_ROWS);
export const OFFICE_EXTENSIONS = new Set(OFFICE_FORMAT_ROWS.map(([format]) => `.${format}`));
export const OOXML_FALLBACK_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const MIME_BY_EXTENSION = new Map(OFFICE_FORMAT_ROWS.map(([format, mimeType]) => [`.${format}`, mimeType]));
export function officeFormatForPath(pathOrExtension) {
    const extension = extensionFromPathLike(pathOrExtension);
    return OFFICE_EXTENSIONS.has(extension) ? extension.slice(1) : undefined;
}
export function isOfficeDocument(pathOrExtension) {
    return officeFormatForPath(pathOrExtension) !== undefined;
}
export function getDocumentMimeType(pathOrExtension) {
    return MIME_BY_EXTENSION.get(extensionFromPathLike(pathOrExtension));
}
export function extensionFromPathLike(pathOrExtension) {
    const normalized = pathOrExtension.trim().replace(/\\/g, '/');
    const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
    if (/^\.[^.]+$/.test(basename))
        return basename.toLowerCase();
    const dot = basename.lastIndexOf('.');
    return dot >= 0 ? basename.slice(dot).toLowerCase() : '';
}
