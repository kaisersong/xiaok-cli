import { appendFileSync, statSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { acquireTranscriptLease, archiveTranscript, defaultTranscriptRoot, isIncompleteJsonTail, iterateTranscriptLines, prepareTranscriptWriter, readTranscriptJsonValues, sealTranscriptWriter, transcriptPaths, TranscriptStorageError, } from './transcript-storage.js';
export { archiveTranscript, TranscriptStorageError, };
export function normalizeTranscriptChunk(chunk) {
    return chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
}
const transcriptCapLogger = createLogger('transcript', { stderr: false });
const DEFAULT_TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;
function resolveTranscriptMaxBytes() {
    const raw = process.env.XIAOK_TRANSCRIPT_MAX_BYTES;
    if (raw !== undefined && raw !== '') {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    return DEFAULT_TRANSCRIPT_MAX_BYTES;
}
export class FileTranscriptLogger {
    sessionId;
    rootDir;
    lease;
    suppressDepth = 0;
    closed = false;
    outputCapWarned = false;
    exitHandler;
    constructor(sessionId, rootDir, lease) {
        this.sessionId = sessionId;
        this.rootDir = rootDir;
        this.lease = lease;
        this.exitHandler = () => {
            try {
                this.close();
            }
            catch { }
        };
        process.once('exit', this.exitHandler);
    }
    static async open(sessionId, rootDir = defaultTranscriptRoot()) {
        const lease = await acquireTranscriptLease(sessionId, rootDir);
        try {
            await prepareTranscriptWriter(sessionId, rootDir);
            return new FileTranscriptLogger(sessionId, rootDir, lease);
        }
        catch (error) {
            lease.close();
            throw error;
        }
    }
    get path() {
        return this.getFilePath();
    }
    beginSuppress() {
        this.suppressDepth += 1;
    }
    endSuppress() {
        this.suppressDepth = Math.max(0, this.suppressDepth - 1);
    }
    record(event) {
        if (this.closed)
            throw new TranscriptStorageError('transcript_writer_closed', `writer is closed: ${this.sessionId}`);
        // Output chunks are the runaway-growth vector (a 2026-09 EIO feedback loop
        // produced a 384GB transcript). Structural events stay small, so they keep
        // recording after the cap trips and the session remains readable.
        if (event.type === 'output' && this.transcriptAtOutputCap()) {
            if (!this.outputCapWarned) {
                this.outputCapWarned = true;
                transcriptCapLogger.warn('transcript output recording disabled after reaching size cap', {
                    sessionId: this.sessionId,
                    path: this.getFilePath(),
                    capBytes: resolveTranscriptMaxBytes(),
                });
            }
            return;
        }
        appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    transcriptAtOutputCap() {
        try {
            return statSync(this.getFilePath()).size >= resolveTranscriptMaxBytes();
        }
        catch {
            return false;
        }
    }
    recordOutput(stream, chunk) {
        if (!chunk)
            return;
        if (this.suppressDepth > 0)
            return;
        this.record({
            type: 'output',
            stream,
            raw: chunk,
            normalized: normalizeTranscriptChunk(chunk),
            timestamp: Date.now(),
        });
    }
    close() {
        if (this.closed)
            return;
        sealTranscriptWriter(this.sessionId, this.rootDir);
        this.lease.close();
        this.closed = true;
        process.removeListener('exit', this.exitHandler);
    }
    getFilePath() {
        return transcriptPaths(this.sessionId, this.rootDir).raw;
    }
}
export function loadTranscriptEvents(sessionId, rootDir = defaultTranscriptRoot()) {
    return readTranscriptJsonValues(sessionId, rootDir);
}
export function analyzeTranscriptEvents(events) {
    const accumulator = new TranscriptAnalysisAccumulator();
    for (const event of events) {
        accumulator.consume(event);
    }
    return accumulator.finalize();
}
export async function analyzeTranscriptFileStreaming(sessionId, rootDir = defaultTranscriptRoot(), options = {}) {
    const accumulator = new TranscriptAnalysisAccumulator();
    const warnings = [];
    for await (const entry of iterateTranscriptLines(sessionId, rootDir, options)) {
        if (!entry.line)
            continue;
        try {
            accumulator.consume(JSON.parse(entry.line));
        }
        catch (error) {
            if (!entry.terminated && isIncompleteJsonTail(entry.line)) {
                warnings.push({ code: 'truncatedTail', line: entry.lineNumber });
                continue;
            }
            throw new Error(`invalid transcript JSON at line ${entry.lineNumber}`, { cause: error });
        }
    }
    return accumulator.finalize(warnings);
}
class TranscriptAnalysisAccumulator {
    eventCount = 0;
    slashPromptGrowth = 0;
    approvalTitleRepeats = 0;
    previousLine = '';
    consume(event) {
        this.eventCount += 1;
        if (event.type !== 'output' || event.stream !== 'stdout')
            return;
        for (const line of event.normalized.split('\n').filter(Boolean)) {
            if (this.previousLine.startsWith('> /') && line.startsWith('> /') && line.startsWith(this.previousLine) && line.length > this.previousLine.length) {
                this.slashPromptGrowth += 1;
            }
            if (line.includes('xiaok 想要执行以下操作') && this.previousLine.includes('xiaok 想要执行以下操作')) {
                this.approvalTitleRepeats += 1;
            }
            this.previousLine = line;
        }
    }
    finalize(warnings = []) {
        return {
            eventCount: this.eventCount,
            slashPromptGrowth: this.slashPromptGrowth,
            approvalTitleRepeats: this.approvalTitleRepeats,
            warnings,
        };
    }
}
