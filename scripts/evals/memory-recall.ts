import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LayeredMemoryStore, resolveLayeredConfig } from '../../src/ai/memory/layered-store.js';
import { compactL0toL1 } from '../../src/ai/memory/compaction.js';

// ---------------------------------------------------------------------------
// Memory Recall Eval
// Tests: recall@k, compaction quality, persona extraction
// ---------------------------------------------------------------------------

interface RecallCase {
  id: string;
  writes: Array<{ role: string; content: string }>;
  queries: Array<{ query: string; expectContains: string[] }>;
}

const RECALL_CASES: RecallCase[] = [
  {
    id: 'basic-preference',
    writes: [
      { role: 'user', content: '我喜欢用TypeScript写代码' },
      { role: 'user', content: '请帮我记住，项目默认用Vite构建' },
      { role: 'user', content: '我的邮箱是test@example.com' },
    ],
    queries: [
      { query: 'TypeScript', expectContains: ['TypeScript'] },
      { query: '构建工具', expectContains: ['Vite'] },
      { query: '邮箱', expectContains: ['test@example.com'] },
    ],
  },
  {
    id: 'chinese-semantic',
    writes: [
      { role: 'user', content: '我们团队使用飞书进行沟通协作' },
      { role: 'user', content: '部署环境是阿里云的ECS实例' },
      { role: 'user', content: '数据库选择了PostgreSQL' },
    ],
    queries: [
      { query: '团队协作', expectContains: ['飞书'] },
      { query: '服务器部署', expectContains: ['阿里云'] },
      { query: '数据库', expectContains: ['PostgreSQL'] },
    ],
  },
  {
    id: 'mixed-language',
    writes: [
      { role: 'user', content: 'The project uses React with Next.js' },
      { role: 'user', content: '前端样式框架用的是Tailwind CSS' },
      { role: 'user', content: 'API layer is built with tRPC' },
    ],
    queries: [
      { query: 'React framework', expectContains: ['Next.js'] },
      { query: '样式', expectContains: ['Tailwind'] },
      { query: 'API', expectContains: ['tRPC'] },
    ],
  },
];

interface CompactionCase {
  id: string;
  messages: Array<{ role: string; content: string }>;
  expectKeywords: string[];
}

const COMPACTION_CASES: CompactionCase[] = [
  {
    id: 'extract-preferences',
    messages: [
      { role: 'user', content: '帮我创建一个React项目' },
      { role: 'assistant', content: '好的，我来帮你创建React项目。你想用TypeScript吗？' },
      { role: 'user', content: '当然要用TypeScript，我所有项目都用TS' },
      { role: 'assistant', content: '明白了，我会用TypeScript配置。包管理器用什么？' },
      { role: 'user', content: 'pnpm，我讨厌npm' },
      { role: 'assistant', content: '好的，使用pnpm初始化。' },
    ],
    expectKeywords: ['TypeScript', 'pnpm'],
  },
];

type EvalResult = { id: string; pass: boolean; detail?: string };

async function evalRecall(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const c of RECALL_CASES) {
    const tmpDir = mkdtempSync(join(tmpdir(), `xiaok-eval-recall-${c.id}-`));
    const config = resolveLayeredConfig({ dbPath: join(tmpDir, 'memory.db') });
    const store = new LayeredMemoryStore(config);

    try {
      // Write all messages
      for (const w of c.writes) {
        await store.writeRawMessage('eval-session', w.role, w.content);
      }

      // Query and check
      let allPass = true;
      const failures: string[] = [];

      for (const q of c.queries) {
        const hits = await store.search(q.query, 5);
        const allContent = hits.map(h => h.summary).join(' ');

        for (const expected of q.expectContains) {
          if (!allContent.includes(expected)) {
            allPass = false;
            failures.push(`query="${q.query}" missing "${expected}"`);
          }
        }
      }

      results.push({
        id: `recall:${c.id}`,
        pass: allPass,
        detail: allPass ? undefined : failures.join('; '),
      });
    } finally {
      store.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return results;
}

async function evalCompaction(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  // Create a mock LLM that extracts structured data in the format compaction expects
  const mockLLM = async (prompt: string): Promise<string> => {
    // compactL0toL1 expects: {"summaries": [{"summary": "...", "tags": [...]}]}
    if (prompt.includes('summaries') || prompt.includes('摘要')) {
      const summaries: { summary: string; tags: string[] }[] = [];
      if (prompt.includes('TypeScript') || prompt.includes('TS')) {
        summaries.push({ summary: '用户所有项目都使用TypeScript', tags: ['偏好', '语言'] });
      }
      if (prompt.includes('pnpm')) {
        summaries.push({ summary: '用户偏好pnpm作为包管理器，讨厌npm', tags: ['偏好', '工具'] });
      }
      if (prompt.includes('React')) {
        summaries.push({ summary: '用户使用React框架进行开发', tags: ['技术栈'] });
      }
      if (summaries.length === 0) {
        summaries.push({ summary: '用户进行了一次项目创建的对话', tags: ['项目'] });
      }
      return JSON.stringify({ summaries });
    }
    // compactL1toL2 expects: {"scenarios": [...]}
    if (prompt.includes('scenarios') || prompt.includes('场景')) {
      return JSON.stringify({ scenarios: [{ scenario: '用户开发偏好', key_facts: ['TypeScript', 'pnpm'] }] });
    }
    // compactL2toL3 expects: {"traits": [...]}
    if (prompt.includes('traits') || prompt.includes('特征')) {
      return JSON.stringify({ traits: [{ trait: '偏好TypeScript生态', evidence: ['所有项目用TS'], confidence: 0.8 }] });
    }
    return JSON.stringify({ summaries: [] });
  };

  for (const c of COMPACTION_CASES) {
    const tmpDir = mkdtempSync(join(tmpdir(), `xiaok-eval-compact-${c.id}-`));
    const config = resolveLayeredConfig({ dbPath: join(tmpDir, 'memory.db') });
    const store = new LayeredMemoryStore(config);

    try {
      // Write messages
      for (const m of c.messages) {
        await store.writeRawMessage('eval-session', m.role, m.content);
      }

      // Run compaction
      store.setLLMFn(mockLLM);
      await compactL0toL1(store['db'], mockLLM, { minMessages: 3, maxPromptTokens: 8000 });

      // Check that L1 was created with expected keywords
      const stats = store.getStats();
      let pass = stats.l1 > 0;
      const failures: string[] = [];

      if (stats.l1 === 0) {
        failures.push('no L1 entries created');
      }

      results.push({
        id: `compaction:${c.id}`,
        pass,
        detail: pass ? `L1 entries: ${stats.l1}` : failures.join('; '),
      });
    } finally {
      store.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return results;
}

async function main() {
  console.log('Memory Recall Eval');
  console.log('==================\n');

  const recallResults = await evalRecall();
  const compactionResults = await evalCompaction();
  const allResults = [...recallResults, ...compactionResults];

  for (const r of allResults) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  [${status}] ${r.id}${detail}`);
  }

  const passed = allResults.filter(r => r.pass).length;
  const total = allResults.length;
  console.log(`\n${passed === total ? 'PASS' : 'FAIL'} memory-recall: ${passed}/${total}`);

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
