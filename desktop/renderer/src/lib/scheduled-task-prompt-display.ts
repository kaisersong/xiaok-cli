export interface ScheduledTaskPromptMetadata {
  taskId?: string;
  timedActionId?: string;
  title?: string;
  scheduledDueAt?: number;
  claimedAt?: number;
  overdueMs?: number;
}

export interface ScheduledTaskPromptDisplay {
  displayPrompt: string;
  metadata?: ScheduledTaskPromptMetadata;
  notice?: string;
}

const SYSTEM_LINE_RE = /^\s*\[SYSTEM:[\s\S]*\]\s*$/;

export function parseScheduledTaskPromptDisplay(prompt: string): ScheduledTaskPromptDisplay {
  const metadata: ScheduledTaskPromptMetadata = {};
  const visibleLines: string[] = [];

  for (const line of prompt.split(/\r?\n/)) {
    if (SYSTEM_LINE_RE.test(line)) {
      mergeScheduledMetadata(metadata, line);
      continue;
    }
    visibleLines.push(line);
  }

  const displayPrompt = visibleLines
    .join('\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
  const hasMetadata = Object.values(metadata).some(value => value !== undefined);
  const normalizedMetadata = hasMetadata ? metadata : undefined;

  return {
    displayPrompt,
    metadata: normalizedMetadata,
    notice: normalizedMetadata ? formatScheduledTaskNotice(normalizedMetadata) : undefined,
  };
}

function mergeScheduledMetadata(metadata: ScheduledTaskPromptMetadata, line: string): void {
  metadata.taskId ??= readStringField(line, 'scheduled_task_id');
  metadata.timedActionId ??= readStringField(line, 'timed_action_id');
  metadata.title ??= readStringField(line, 'timed_action_title');
  metadata.scheduledDueAt ??= readTimestampField(line, 'scheduled_due_at');
  metadata.claimedAt ??= readTimestampField(line, 'claimed_at');
  metadata.overdueMs ??= readNumberField(line, 'overdue_ms');
}

function readStringField(line: string, key: string): string | undefined {
  const match = new RegExp(`${key}=([^;\\]]+)`).exec(line);
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
}

function readTimestampField(line: string, key: string): number | undefined {
  const raw = readStringField(line, key);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNumberField(line: string, key: string): number | undefined {
  const raw = readStringField(line, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatScheduledTaskNotice(metadata: ScheduledTaskPromptMetadata): string {
  const title = metadata.title ? `「${metadata.title}」` : '';
  const parts = [`定时任务${title}`];
  if (metadata.scheduledDueAt !== undefined) {
    parts.push(`计划执行 ${formatLocalDateTime(metadata.scheduledDueAt)}`);
  }
  if (metadata.claimedAt !== undefined) {
    parts.push(`实际执行 ${formatLocalDateTime(metadata.claimedAt)}`);
  }
  if (metadata.overdueMs !== undefined && metadata.overdueMs >= 1000) {
    parts.push(`延迟 ${formatDuration(metadata.overdueMs)}`);
  }
  return parts.join(' · ');
}

function formatLocalDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟`;
}
