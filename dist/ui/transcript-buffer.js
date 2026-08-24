import { bold, cyan, dim, red } from './render.js';
import { formatImagePlaceholder } from './image-renderer.js';
export const TRANSCRIPT_ENTRY_BYTE_LIMIT = 64 * 1024;
export const TRANSCRIPT_SESSION_BYTE_LIMIT = 8 * 1024 * 1024;
function truncateToBytes(text, limit) {
    if (Buffer.byteLength(text, 'utf8') <= limit)
        return text;
    const buffer = Buffer.from(text, 'utf8').subarray(0, limit);
    let start = buffer.length;
    while (start > 0 && (buffer[start - 1] & 0xc0) === 0x80)
        start -= 1;
    if (start === 0)
        return '';
    const lead = buffer[start - 1];
    const needed = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    const available = buffer.length - (start - 1);
    const end = available >= needed ? buffer.length : start - 1;
    return buffer.subarray(0, end).toString('utf8');
}
function annotateTruncation(text, limit) {
    const originalBytes = Buffer.byteLength(text, 'utf8');
    if (originalBytes <= limit)
        return text;
    const kb = Math.round(originalBytes / 1024);
    return `${truncateToBytes(text, limit)}\n… [truncated, original ${kb} KB]`;
}
function entryBytes(entry) {
    switch (entry.kind) {
        case 'user':
        case 'assistant':
        case 'thinking':
        case 'system':
            return Buffer.byteLength(entry.text, 'utf8');
        case 'tool_use':
            return Buffer.byteLength(entry.summary, 'utf8') + Buffer.byteLength(entry.name, 'utf8');
        case 'tool_result':
            return Buffer.byteLength(entry.content, 'utf8') + Buffer.byteLength(entry.name, 'utf8');
        case 'command_output':
            return Buffer.byteLength(entry.output, 'utf8') + Buffer.byteLength(entry.command, 'utf8');
        case 'image':
            return Buffer.byteLength(entry.mediaType, 'utf8');
    }
}
export class TranscriptBuffer {
    entries = [];
    totalBytes = 0;
    entryByteLimit;
    sessionByteLimit;
    onError;
    constructor(options = {}) {
        this.entryByteLimit = options.entryByteLimit ?? TRANSCRIPT_ENTRY_BYTE_LIMIT;
        this.sessionByteLimit = options.sessionByteLimit ?? TRANSCRIPT_SESSION_BYTE_LIMIT;
        this.onError = options.onError;
    }
    /**
     * Never throws: an exception here would surface to the model as a tool error
     * because onToolObserved is awaited inside ToolRegistry.execute's try block.
     */
    record(entry) {
        try {
            const capped = this.cap(entry);
            this.entries.push(capped);
            this.totalBytes += entryBytes(capped);
            this.evictIfNeeded();
        }
        catch (error) {
            this.onError?.(error);
        }
    }
    getEntries() {
        return [...this.entries];
    }
    getTotalBytes() {
        return this.totalBytes;
    }
    isEmpty() {
        return this.entries.length === 0;
    }
    clear() {
        this.entries = [];
        this.totalBytes = 0;
    }
    cap(entry) {
        switch (entry.kind) {
            case 'user':
            case 'assistant':
            case 'thinking':
            case 'system':
                return { kind: entry.kind, text: annotateTruncation(entry.text, this.entryByteLimit) };
            case 'tool_use':
                return {
                    kind: 'tool_use',
                    agentId: entry.agentId,
                    name: entry.name,
                    summary: annotateTruncation(entry.summary, this.entryByteLimit),
                };
            case 'tool_result':
                return {
                    kind: 'tool_result',
                    agentId: entry.agentId,
                    name: entry.name,
                    isError: entry.isError,
                    content: annotateTruncation(entry.content, this.entryByteLimit),
                };
            case 'command_output':
                return {
                    kind: 'command_output',
                    command: entry.command,
                    output: annotateTruncation(entry.output, this.entryByteLimit),
                };
            case 'image':
                return {
                    kind: 'image',
                    mediaType: entry.mediaType,
                    ...(entry.width === undefined ? {} : { width: entry.width }),
                    ...(entry.height === undefined ? {} : { height: entry.height }),
                };
        }
    }
    evictIfNeeded() {
        if (this.totalBytes <= this.sessionByteLimit)
            return;
        for (let index = 0; index < this.entries.length - 1; index += 1) {
            if (this.totalBytes <= this.sessionByteLimit)
                return;
            const entry = this.entries[index];
            if (entry.kind !== 'tool_result')
                continue;
            if (entry.content.startsWith('… [evicted'))
                continue;
            const before = entryBytes(entry);
            const evicted = {
                kind: 'tool_result',
                agentId: entry.agentId,
                name: entry.name,
                isError: entry.isError,
                content: `… [evicted, ${Math.round(Buffer.byteLength(entry.content, 'utf8') / 1024)} KB dropped to stay within the session budget]`,
            };
            this.entries[index] = evicted;
            this.totalBytes -= before - entryBytes(evicted);
        }
    }
}
export function recordToolObservation(buffer, event) {
    buffer.record({
        kind: 'tool_result',
        agentId: event.agentId,
        name: event.toolName,
        content: event.result,
        isError: !event.ok,
    });
}
function agentPrefix(agentId) {
    return agentId && agentId !== 'main' ? `[subagent: ${agentId}] ` : '';
}
function indent(text) {
    return text
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
}
export function renderTranscriptText(entries) {
    if (entries.length === 0) {
        return `${dim('(本次会话还没有可查看的内容)')}\n`;
    }
    const lines = [];
    for (const entry of entries) {
        switch (entry.kind) {
            case 'user':
                lines.push(bold(cyan('> ')) + entry.text, '');
                break;
            case 'assistant':
                lines.push(entry.text, '');
                break;
            case 'thinking':
                lines.push(dim(`* thinking`), dim(indent(entry.text)), '');
                break;
            case 'tool_use':
                lines.push(dim(`● ${agentPrefix(entry.agentId)}${entry.name}: ${entry.summary}`));
                break;
            case 'tool_result': {
                const marker = entry.isError ? red('(error)') : dim('(ok)');
                lines.push(dim(`  ↳ ${agentPrefix(entry.agentId)}${entry.name} `) + marker);
                lines.push(indent(entry.content), '');
                break;
            }
            case 'command_output':
                lines.push(bold(entry.command), indent(entry.output), '');
                break;
            case 'image':
                lines.push(dim(`  ↳ ${formatImagePlaceholder(entry.width && entry.height ? { width: entry.width, height: entry.height } : null)}`), '');
                break;
            case 'system':
                lines.push(dim(entry.text), '');
                break;
        }
    }
    return `${lines.join('\n')}\n`;
}
