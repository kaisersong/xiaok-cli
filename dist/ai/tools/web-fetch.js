import { truncateText } from './truncation.js';
function stripHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
export function createWebFetchTool(options = {}) {
    const fetchFn = options.fetchFn ?? fetch;
    return {
        permission: 'safe',
        definition: {
            name: 'web_fetch',
            description: '抓取网页或文本内容，并返回适合模型阅读的纯文本摘要',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: '要抓取的 URL' },
                    max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
                },
                required: ['url'],
            },
        },
        async execute(input) {
            const { url, max_chars = 12_000 } = input;
            try {
                const response = await fetchFn(url);
                if (!response.ok) {
                    return `Error: 请求失败 (${response.status} ${response.statusText})`;
                }
                const contentType = response.headers.get('content-type') ?? 'text/plain';
                const body = await response.text();
                const normalized = /html/i.test(contentType) ? stripHtml(body) : body.trim();
                const truncated = truncateText(normalized, max_chars);
                return [`URL: ${url}`, `Content-Type: ${contentType}`, '', truncated.text].join('\n');
            }
            catch (error) {
                return `Error: ${String(error)}`;
            }
        },
    };
}
export const webFetchTool = createWebFetchTool();
