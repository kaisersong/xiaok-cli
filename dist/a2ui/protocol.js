export const A2UI_MIME_TYPE = 'application/vnd.xiaok.a2ui+json';
export const SAFE_A2UI_CATALOG_ID = 'xiaok-safe';
export const A2UI_PROTOCOL_VERSION = 1;
export const RENDER_UI_SECTION_KINDS = ['heading', 'text', 'metric', 'table', 'list', 'divider'];
export const A2UI_LIMITS = {
    maxMessages: 50,
    maxComponents: 100,
    maxTreeDepth: 8,
    maxChildrenPerNode: 20,
    maxDataModelBytes: 500_000,
    maxSinglePropBytes: 100_000,
    maxStringLen: 10_000,
    maxTableRows: 200,
    maxTableCols: 10,
    maxTableCellLen: 1_000,
    maxMetricValueLen: 50,
    maxSections: 30,
};
export function formatA2UIBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return '0 B';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function isA2UIMimeType(value) {
    return typeof value === 'string' && value.toLowerCase().split(';')[0]?.trim() === A2UI_MIME_TYPE;
}
export function sanitizeA2UIIdPart(value) {
    const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return sanitized || 'local';
}
export function summarizeRenderUiInput(input) {
    const record = input != null && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};
    const title = typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : 'Untitled UI';
    const sectionCount = Array.isArray(record.sections) ? record.sections.length : 0;
    const payloadBytes = new TextEncoder().encode(JSON.stringify({
        title: record.title,
        sections: record.sections,
        data: record.data,
    })).length;
    const sectionLabel = sectionCount === 1 ? 'section' : 'sections';
    return {
        title,
        sectionCount,
        payloadBytes,
        summary: `[A2UI] ${title} - ${sectionCount} ${sectionLabel}, ${formatA2UIBytes(payloadBytes)}`,
    };
}
