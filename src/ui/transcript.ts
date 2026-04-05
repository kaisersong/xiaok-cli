import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../utils/config.js';

export type TranscriptEvent =
  | { type: 'input_key'; key: string; timestamp: number }
  | { type: 'input_submit'; value: string; timestamp: number }
  | { type: 'permission_prompt_open'; toolName: string; timestamp: number }
  | { type: 'permission_prompt_navigate'; direction: 'up' | 'down'; timestamp: number }
  | { type: 'permission_prompt_decision'; action: string; timestamp: number }
  | { type: 'output'; stream: 'stdout' | 'stderr'; raw: string; normalized: string; timestamp: number };

export interface TranscriptLogger {
  record(event: TranscriptEvent): void;
  recordOutput(stream: 'stdout' | 'stderr', chunk: string): void;
}

export interface TranscriptAnalysis {
  slashPromptGrowth: number;
  approvalTitleRepeats: number;
}

export function normalizeTranscriptChunk(chunk: string): string {
  return chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
}

export class FileTranscriptLogger implements TranscriptLogger {
  constructor(
    private readonly sessionId: string,
    private readonly rootDir = join(getConfigDir(), 'transcripts'),
  ) {}

  get path(): string {
    return this.getFilePath();
  }

  record(event: TranscriptEvent): void {
    mkdirSync(this.rootDir, { recursive: true });
    appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, 'utf8');
  }

  recordOutput(stream: 'stdout' | 'stderr', chunk: string): void {
    if (!chunk) return;
    this.record({
      type: 'output',
      stream,
      raw: chunk,
      normalized: normalizeTranscriptChunk(chunk),
      timestamp: Date.now(),
    });
  }

  private getFilePath(): string {
    return join(this.rootDir, `${this.sessionId}.jsonl`);
  }
}

export function loadTranscriptEvents(
  sessionId: string,
  rootDir = join(getConfigDir(), 'transcripts'),
): TranscriptEvent[] {
  const filePath = join(rootDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) {
    throw new Error(`transcript not found: ${sessionId}`);
  }

  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranscriptEvent);
}

export function analyzeTranscriptEvents(events: TranscriptEvent[]): TranscriptAnalysis {
  const stdoutLines = events
    .filter((event): event is Extract<TranscriptEvent, { type: 'output' }> => event.type === 'output' && event.stream === 'stdout')
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
