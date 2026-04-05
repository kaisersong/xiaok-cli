import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../utils/config.js';
export function normalizeTranscriptChunk(chunk) {
    return chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
}
export class FileTranscriptLogger {
    sessionId;
    rootDir;
    constructor(sessionId, rootDir = join(getConfigDir(), 'transcripts')) {
        this.sessionId = sessionId;
        this.rootDir = rootDir;
    }
    get path() {
        return this.getFilePath();
    }
    record(event) {
        mkdirSync(this.rootDir, { recursive: true });
        appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, 'utf8');
    }
    recordOutput(stream, chunk) {
        if (!chunk)
            return;
        this.record({
            type: 'output',
            stream,
            raw: chunk,
            normalized: normalizeTranscriptChunk(chunk),
            timestamp: Date.now(),
        });
    }
    getFilePath() {
        return join(this.rootDir, `${this.sessionId}.jsonl`);
    }
}
export function loadTranscriptEvents(sessionId, rootDir = join(getConfigDir(), 'transcripts')) {
    const filePath = join(rootDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
        throw new Error(`transcript not found: ${sessionId}`);
    }
    return readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
export function analyzeTranscriptEvents(events) {
    const stdoutLines = events
        .filter((event) => event.type === 'output' && event.stream === 'stdout')
        .flatMap((event) => event.normalized.split('\n').filter(Boolean));
    let slashPromptGrowth = 0;
    let approvalTitleRepeats = 0;
    let previousLine = '';
    for (const line of stdoutLines) {
        if (previousLine.startsWith('> /') && line.startsWith('> /') && line.startsWith(previousLine) && line.length > previousLine.length) {
            slashPromptGrowth += 1;
        }
        if (line.includes('xiaok 想要执行以下操作') && previousLine.includes('xiaok 想要执行以下操作')) {
            approvalTitleRepeats += 1;
        }
        previousLine = line;
    }
    return {
        slashPromptGrowth,
        approvalTitleRepeats,
    };
}
