const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_NOTICE = '\n...(已截断)';

export interface PaginationResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface TruncationResult {
  text: string;
  truncated: boolean;
}

export function paginateItems<T>(items: T[], offset = 0, limit = items.length): PaginationResult<T> {
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

export function truncateText(text: string, maxChars = DEFAULT_MAX_CHARS, notice = DEFAULT_NOTICE): TruncationResult {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const sliceLength = Math.max(0, maxChars - notice.length);
  return {
    text: text.slice(0, sliceLength) + notice,
    truncated: true,
  };
}

export function appendPaginationNotice(text: string, nextOffset: number | null): string {
  if (nextOffset === null) {
    return text;
  }

  return `${text}\n...(更多结果，请使用 offset=${nextOffset} 继续)`;
}
