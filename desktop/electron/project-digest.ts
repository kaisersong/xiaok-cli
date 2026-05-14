export interface DigestSkillStat {
  name: string;
  count: number;
  status: 'success' | 'error' | 'mixed';
  errorCount: number;
  avgDurationMs: number;
}

export interface DigestDeliverable {
  name: string;
  type: string;
}

export interface DigestEntry {
  threadId: string;
  title: string;
  status: string;
  createdAt: number;
  skillStats: DigestSkillStat[];
  deliverables: DigestDeliverable[];
}

export interface DigestResult {
  entries: DigestEntry[];
  totalThreads: number;
  since: number;
}

export interface DigestInput {
  threads: Array<{
    id: string;
    title: string | null;
    status: string;
    createdAt: number;
    updatedAt: number;
    taskIds: string[];
    currentTaskId: string | null;
  }>;
  skillExecRecords: Array<{
    skillNames: string[];
    taskId: string;
    startTime: number;
    endTime: number;
    durationMs: number;
    status: string;
  }>;
  since: number;
}

export function buildDigest(input: DigestInput): DigestResult {
  const { threads, skillExecRecords, since } = input;

  const filtered = threads.filter(t => t.createdAt >= since);

  const taskIdToThreadIdx = new Map<string, number>();
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i];
    for (const tid of t.taskIds) taskIdToThreadIdx.set(tid, i);
    if (t.currentTaskId) taskIdToThreadIdx.set(t.currentTaskId, i);
  }

  const entries: DigestEntry[] = filtered.map(t => ({
    threadId: t.id,
    title: t.title || 'Untitled',
    status: t.status,
    createdAt: t.createdAt,
    skillStats: [],
    deliverables: [],
  }));

  for (const rec of skillExecRecords) {
    if (!rec || !Array.isArray(rec.skillNames)) continue;
    if (!rec.taskId) continue;
    const idx = taskIdToThreadIdx.get(rec.taskId);
    if (idx === undefined) continue;

    const entry = entries[idx];
    if (!entry) continue;

    const names = rec.skillNames.length > 0 ? rec.skillNames : [];
    for (const name of names) {
      let stat = entry.skillStats.find(s => s.name === name);
      if (!stat) {
        stat = { name, count: 0, status: 'success', errorCount: 0, avgDurationMs: 0 };
        entry.skillStats.push(stat);
      }
      stat.count++;
      if (rec.status === 'error') stat.errorCount++;
      stat.avgDurationMs = Math.round(
        (stat.avgDurationMs * (stat.count - 1) + (rec.durationMs || 0)) / stat.count
      );
      if (stat.errorCount > 0 && stat.count > stat.errorCount) stat.status = 'mixed';
      else if (stat.errorCount > 0) stat.status = 'error';
    }
  }

  return { entries, totalThreads: filtered.length, since };
}

export function formatDigestMarkdown(result: DigestResult): string {
  if (result.entries.length === 0) return '暂无活动';

  const lines: string[] = [];

  for (const entry of result.entries) {
    lines.push(`### ${entry.title}`);
    lines.push(`状态: ${entry.status} · ${formatTime(entry.createdAt)}`);

    if (entry.skillStats.length > 0) {
      lines.push('');
      for (const s of entry.skillStats) {
        const err = s.errorCount > 0 ? ` (${s.errorCount} 次失败)` : '';
        lines.push(`- **${s.name}**: ${s.count} 次${err} · 平均 ${formatDuration(s.avgDurationMs)}`);
      }
    }

    if (entry.deliverables.length > 0) {
      lines.push('');
      lines.push('产出:');
      for (const d of entry.deliverables) {
        lines.push(`- ${d.name}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  return d.toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}
