import { appendFileSync } from 'node:fs';
import {
  acquireTranscriptLease,
  archiveTranscript,
  defaultTranscriptRoot,
  isIncompleteJsonTail,
  iterateTranscriptLines,
  prepareTranscriptWriter,
  readTranscriptJsonValues,
  sealTranscriptWriter,
  transcriptPaths,
  TranscriptStorageError,
  type TranscriptArchiveOptions,
  type TranscriptArchivePhase,
  type TranscriptArchiveResult,
  type TranscriptReadOptions,
  type TranscriptSessionLease,
} from './transcript-storage.js';

export {
  archiveTranscript,
  TranscriptStorageError,
  type TranscriptArchiveOptions,
  type TranscriptArchivePhase,
  type TranscriptArchiveResult,
  type TranscriptReadOptions,
};

export type TranscriptEvent =
  | { type: 'input_key'; key: string; timestamp: number }
  | { type: 'input_read_attach'; timestamp: number }
  | { type: 'input_read_detach'; reason: 'submit' | 'cancel' | 'eof'; timestamp: number }
  | { type: 'input_submit'; value: string; timestamp: number }
  | { type: 'input_queue_submit'; value: string; timestamp: number }
  | { type: 'input_queue_replace'; oldValue: string; newValue: string; timestamp: number }
  | { type: 'input_queue_edit'; value: string; timestamp: number }
  | { type: 'input_queue_cancel'; value?: string; timestamp: number }
  | { type: 'input_queue_dequeue'; value: string; timestamp: number }
  | { type: 'busy_capture_attach'; timestamp: number }
  | { type: 'busy_capture_detach'; reason: 'pause' | 'stop' | 'disabled' | 'ui_error'; timestamp: number }
  | { type: 'permission_prompt_open'; toolName: string; timestamp: number }
  | { type: 'permission_prompt_navigate'; direction: 'up' | 'down'; timestamp: number }
  | { type: 'permission_prompt_decision'; action: string; timestamp: number }
  | { type: 'output'; stream: 'stdout' | 'stderr'; raw: string; normalized: string; timestamp: number };

export interface TranscriptLogger {
  record(event: TranscriptEvent): void;
  recordOutput(stream: 'stdout' | 'stderr', chunk: string): void;
  beginSuppress(): void;
  endSuppress(): void;
  close(): void;
}

export interface TranscriptAnalysis {
  eventCount: number;
  slashPromptGrowth: number;
  approvalTitleRepeats: number;
  warnings: TranscriptAnalysisWarning[];
}

export interface TranscriptAnalysisWarning {
  code: 'truncatedTail';
  line: number;
}

export function normalizeTranscriptChunk(chunk: string): string {
  return chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
}

export class FileTranscriptLogger implements TranscriptLogger {
  private suppressDepth = 0;
  private closed = false;
  private readonly exitHandler: () => void;

  private constructor(
    private readonly sessionId: string,
    private readonly rootDir: string,
    private readonly lease: TranscriptSessionLease,
  ) {
    this.exitHandler = () => {
      try { this.close(); } catch {}
    };
    process.once('exit', this.exitHandler);
  }

  static async open(
    sessionId: string,
    rootDir = defaultTranscriptRoot(),
  ): Promise<FileTranscriptLogger> {
    const lease = await acquireTranscriptLease(sessionId, rootDir);
    try {
      await prepareTranscriptWriter(sessionId, rootDir);
      return new FileTranscriptLogger(sessionId, rootDir, lease);
    } catch (error) {
      lease.close();
      throw error;
    }
  }

  get path(): string {
    return this.getFilePath();
  }

  beginSuppress(): void {
    this.suppressDepth += 1;
  }

  endSuppress(): void {
    this.suppressDepth = Math.max(0, this.suppressDepth - 1);
  }

  record(event: TranscriptEvent): void {
    if (this.closed) throw new TranscriptStorageError('transcript_writer_closed', `writer is closed: ${this.sessionId}`);
    appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  recordOutput(stream: 'stdout' | 'stderr', chunk: string): void {
    if (!chunk) return;
    if (this.suppressDepth > 0) return;
    this.record({
      type: 'output',
      stream,
      raw: chunk,
      normalized: normalizeTranscriptChunk(chunk),
      timestamp: Date.now(),
    });
  }

  close(): void {
    if (this.closed) return;
    sealTranscriptWriter(this.sessionId, this.rootDir);
    this.lease.close();
    this.closed = true;
    process.removeListener('exit', this.exitHandler);
  }

  private getFilePath(): string {
    return transcriptPaths(this.sessionId, this.rootDir).raw;
  }
}

export function loadTranscriptEvents(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
): TranscriptEvent[] {
  return readTranscriptJsonValues(sessionId, rootDir) as TranscriptEvent[];
}

export function analyzeTranscriptEvents(events: TranscriptEvent[]): TranscriptAnalysis {
  const accumulator = new TranscriptAnalysisAccumulator();
  for (const event of events) {
    accumulator.consume(event);
  }
  return accumulator.finalize();
}

export async function analyzeTranscriptFileStreaming(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
  options: TranscriptReadOptions = {},
): Promise<TranscriptAnalysis> {
  const accumulator = new TranscriptAnalysisAccumulator();
  const warnings: TranscriptAnalysisWarning[] = [];
  for await (const entry of iterateTranscriptLines(sessionId, rootDir, options)) {
    if (!entry.line) continue;
    try {
      accumulator.consume(JSON.parse(entry.line) as TranscriptEvent);
    } catch (error) {
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
  private eventCount = 0;
  private slashPromptGrowth = 0;
  private approvalTitleRepeats = 0;
  private previousLine = '';

  consume(event: TranscriptEvent): void {
    this.eventCount += 1;
    if (event.type !== 'output' || event.stream !== 'stdout') return;

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

  finalize(warnings: TranscriptAnalysisWarning[] = []): TranscriptAnalysis {
    return {
      eventCount: this.eventCount,
      slashPromptGrowth: this.slashPromptGrowth,
      approvalTitleRepeats: this.approvalTitleRepeats,
      warnings,
    };
  }
}
