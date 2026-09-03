import type { Command } from 'commander';
import { analyzeTranscriptFileStreaming, archiveTranscript } from '../ui/transcript.js';

export interface TranscriptCommandOptions {
  gzip?: boolean;
  olderThanDays?: number;
}

export async function runTranscriptCommand(
  sessionId: string,
  options: TranscriptCommandOptions = {},
): Promise<string> {
  if (options.gzip) {
    const result = await archiveTranscript(sessionId, { olderThanDays: options.olderThanDays });
    return [
      'Transcript Archived',
      '',
      `- sessionId=${result.sessionId}`,
      `- status=${result.status}`,
      `- sourceBytes=${result.sourceBytes}`,
      `- compressedBytes=${result.compressedBytes}`,
      `- bytesFreed=${result.bytesFreed}`,
      `- segmentCount=${result.segmentCount}`,
      '- safety=同权限外部进程若绕过会话租约并持有 writable fd，不属于受支持写入路径',
    ].join('\n');
  }
  if (options.olderThanDays !== undefined) {
    throw new Error('--older-than-days requires --gzip');
  }
  const analysis = await analyzeTranscriptFileStreaming(sessionId);

  const lines = [
    'Transcript Analysis',
    '',
    `- sessionId=${sessionId}`,
    `- events=${analysis.eventCount}`,
    `- slashPromptGrowth=${analysis.slashPromptGrowth}`,
    `- approvalTitleRepeats=${analysis.approvalTitleRepeats}`,
  ];
  for (const warning of analysis.warnings) {
    lines.push(`- warning=${warning.code}:line=${warning.line}`);
  }
  return lines.join('\n');
}

export function registerTranscriptCommands(program: Command): void {
  program
    .command('transcript')
    .description('分析会话 transcript，检查交互与执行质量')
    .argument('<sessionId>', '会话 ID')
    .option('--gzip', '安全压缩并归档指定的非活动 transcript')
    .option('--older-than-days <days>', '只归档至少指定天数未修改的 transcript（默认 7）', parseOlderThanDays)
    .action(async (sessionId: string, options: TranscriptCommandOptions) => {
      console.log(await runTranscriptCommand(sessionId, options));
    });
}

function parseOlderThanDays(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('--older-than-days must be a non-negative number');
  }
  return parsed;
}
