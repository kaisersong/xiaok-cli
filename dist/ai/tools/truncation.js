const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_NOTICE = '\n...(已截断)';
export function paginateItems(items, offset = 0, limit = items.length) {
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(1, limit);
    const page = items.slice(safeOffset, safeOffset + safeLimit);
    const nextOffset = safeOffset + page.length;
    return {
        items: page,
        total: items.length,
        offset: safeOffset,
        limit: safeLimit,
        hasMore: nextOffset < items.length,
        nextOffset: nextOffset < items.length ? nextOffset : null,
    };
}
export function truncateText(text, maxChars = DEFAULT_MAX_CHARS, notice = DEFAULT_NOTICE) {
    if (text.length <= maxChars) {
        return { text, truncated: false };
    }
    const sliceLength = Math.max(0, maxChars - notice.length);
    return {
        text: text.slice(0, sliceLength) + notice,
        truncated: true,
    };
}
export function appendPaginationNotice(text, nextOffset) {
    if (nextOffset === null) {
        return text;
    }
    return `${text}\n...(更多结果，请使用 offset=${nextOffset} 继续)`;
}
