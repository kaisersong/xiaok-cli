import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function formatRate(rate) {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Persists the run report: machine-readable report.json + human summary.md.
 * The headline metric is STRUCTURAL PASS RATE — deliberately not called
 * "completion rate" or "quality score" (weak-proxy caveat, design §4).
 */
export async function writeRunReport({ runRoot, summary, records, meta }) {
  const outDir = join(runRoot, 'xiaok-product-eval');
  await mkdir(outDir, { recursive: true });

  await writeFile(
    join(outDir, 'report.json'),
    JSON.stringify({ meta, summary, records }, null, 2),
    'utf8',
  );

  const lines = [
    '# 小K Desktop 产品效果评测（快照式评估）',
    '',
    `- 运行时间：${meta.startedAt} → ${meta.finishedAt}`,
    `- 任务数：${meta.taskCount}，session 数：${summary.total}`,
    '',
    '> 注意：**结构达标率 ≠ 交付质量**。结构阈值是弱代理指标；本报告是快照式评估，不构成严格回归基线。',
    '',
    '## 总览',
    '',
    `- 结构达标率：${formatRate(summary.structuralPassRate)}`
      + (summary.wilson
        ? `（Wilson 95% CI: ${formatRate(summary.wilson.lower)} – ${formatRate(summary.wilson.upper)}）`
        : ''),
    `- 计分 session：${summary.scoredCount}（passed ${summary.passedCount}）`,
    `- infra-error：${summary.infraErrorCount}（不计入结构达标率）`,
    `- budget-exceeded：${summary.budgetExceededCount}`,
    '',
    '## 分类目',
    '',
    '| 类目 | 计分 | 通过 | infra |',
    '|---|---|---|---|',
    ...Object.entries(summary.perCategory).map(([category, bucket]) => (
      `| ${category} | ${bucket.scoredCount} | ${bucket.passedCount} | ${bucket.infraErrorCount} |`
    )),
    '',
    '## pass^k（同任务多次全通过）',
    '',
    '| 任务 | pass^k |',
    '|---|---|',
    ...Object.entries(summary.passKByTask).map(([taskId, value]) => (
      `| ${taskId} | ${value === null ? 'incomplete (infra)' : value ? '✅' : '❌'} |`
    )),
    '',
    '## 失败 session',
    '',
    ...records
      .filter(record => record.status !== 'passed')
      .map(record => (
        `- ${record.sessionKey} [${record.status}]`
        + (record.reasons?.length ? `：${record.reasons.join('；')}` : '')
        + (record.failureDir ? `（复盘：${record.failureDir}）` : '')
      )),
    '',
  ];
  await writeFile(join(outDir, 'summary.md'), lines.join('\n'), 'utf8');
  return outDir;
}
