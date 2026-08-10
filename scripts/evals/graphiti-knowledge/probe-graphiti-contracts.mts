/**
 * Graphiti structured-output contract probe.
 *
 * Graphiti drives several strict Pydantic schemas during ingestion. The
 * 2026-08-07 DeepSeek G0 runs failed on two of them specifically:
 *   - stream-v1: Event.description came back null (required string)
 *   - stream-v2: EdgeDuplicate fields were nested under `properties`, so the
 *     required top-level duplicate_facts / contradicted_facts were missing
 *
 * Schemas below are transcribed from the Graphiti source that produced those
 * runs, not invented:
 *   graphiti_core/prompts/extract_nodes.py:28   ExtractedEntity / ExtractedEntities
 *   graphiti_core/prompts/extract_edges.py:25   Edge / ExtractedEdges
 *   graphiti_core/prompts/extract_edges.py:59   EdgeTimestamps
 *   graphiti_core/prompts/dedupe_edges.py:24    EdgeDuplicate
 *   graphiti_core/prompts/dedupe_nodes.py:25    NodeDuplicate / NodeResolutions
 *   mcp_server/src/models/entity_types.py:89    Event
 *
 * Purpose: decide whether any already-configured model satisfies these natively,
 * before committing to build a compatibility adapter for one that does not.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeModelBinding } from '/Users/song/projects/xiaok-cli/src/ai/providers/control-plane.js';
import { normalizeConfig } from '/Users/song/projects/xiaok-cli/src/ai/providers/normalize.js';

interface Contract {
  id: string;
  source: string;
  prompt: string;
  schema: Record<string, unknown>;
  validate: (value: unknown) => string | null;
}

const isIntArray = (value: unknown) => Array.isArray(value) && value.every((v) => Number.isInteger(v));

const CONTRACTS: Contract[] = [
  {
    id: 'ExtractedEntities',
    source: 'graphiti_core/prompts/extract_nodes.py:41',
    prompt: '文本：「小K 在 2026 年发布了知识图谱功能，由张伟负责。」\n'
      + 'entity_type_id 可选值：0=Person, 1=Organization, 2=Event。抽取实体。',
    schema: {
      name: 'ExtractedEntities',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['extracted_entities'],
        properties: {
          extracted_entities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'entity_type_id', 'episode_indices'],
              properties: {
                name: { type: 'string' },
                entity_type_id: { type: 'integer' },
                episode_indices: { type: 'array', items: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    validate: (value) => {
      const list = (value as { extracted_entities?: unknown })?.extracted_entities;
      if (!Array.isArray(list)) return 'extracted_entities 不是数组';
      if (list.length === 0) return 'extracted_entities 为空';
      for (const item of list) {
        const record = item as Record<string, unknown>;
        if (typeof record.name !== 'string') return 'name 非 string';
        if (!Number.isInteger(record.entity_type_id)) return 'entity_type_id 非 integer';
        if (!isIntArray(record.episode_indices)) return 'episode_indices 非 int[]';
      }
      return null;
    },
  },
  {
    id: 'ExtractedEdges',
    source: 'graphiti_core/prompts/extract_edges.py:55',
    prompt: 'ENTITIES: ["小K", "张伟", "知识图谱功能"]\n'
      + '文本：「小K 在 2026 年发布了知识图谱功能，由张伟负责。」抽取实体间关系。',
    schema: {
      name: 'ExtractedEdges',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['edges'],
        properties: {
          edges: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source_entity_name', 'target_entity_name', 'relation_type', 'fact'],
              properties: {
                source_entity_name: { type: 'string' },
                target_entity_name: { type: 'string' },
                relation_type: { type: 'string' },
                fact: { type: 'string' },
              },
            },
          },
        },
      },
    },
    validate: (value) => {
      const list = (value as { edges?: unknown })?.edges;
      if (!Array.isArray(list)) return 'edges 不是数组';
      if (list.length === 0) return 'edges 为空';
      for (const item of list) {
        const record = item as Record<string, unknown>;
        for (const key of ['source_entity_name', 'target_entity_name', 'relation_type', 'fact']) {
          if (typeof record[key] !== 'string') return `${key} 非 string`;
        }
      }
      return null;
    },
  },
  {
    id: 'EdgeDuplicate',
    source: 'graphiti_core/prompts/dedupe_edges.py:24 —— stream-v2 就在这里失败',
    prompt: 'NEW FACT: "小K 发布了知识图谱功能"\n'
      + 'EXISTING FACTS:\n  idx 0: "小K 上线了知识图谱能力"\n  idx 1: "张伟离职了"\n'
      + '判断 NEW FACT 与哪些 EXISTING FACTS 重复或矛盾。',
    schema: {
      name: 'EdgeDuplicate',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['duplicate_facts', 'contradicted_facts'],
        properties: {
          duplicate_facts: { type: 'array', items: { type: 'integer' } },
          contradicted_facts: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    validate: (value) => {
      const record = value as Record<string, unknown>;
      // stream-v2 的具体失败形态：字段被包进 properties，顶层缺失
      if (record?.properties && !('duplicate_facts' in record)) {
        return '字段被错误包进 properties（与 stream-v2 完全相同的失败形态）';
      }
      if (!isIntArray(record?.duplicate_facts)) return 'duplicate_facts 非 int[]';
      if (!isIntArray(record?.contradicted_facts)) return 'contradicted_facts 非 int[]';
      return null;
    },
  },
  {
    id: 'NodeResolutions',
    source: 'graphiti_core/prompts/dedupe_nodes.py:37',
    prompt: 'ENTITIES:\n  id 0: "小K"\n  id 1: "张伟"\n'
      + 'EXISTING ENTITIES:\n  candidate_id 10: "小K（产品）"\n'
      + '为每个 ENTITY 给出重复判定，无重复用 -1。',
    schema: {
      name: 'NodeResolutions',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_resolutions'],
        properties: {
          entity_resolutions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'duplicate_candidate_id'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                duplicate_candidate_id: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    validate: (value) => {
      const list = (value as { entity_resolutions?: unknown })?.entity_resolutions;
      if (!Array.isArray(list)) return 'entity_resolutions 不是数组';
      if (list.length === 0) return 'entity_resolutions 为空';
      for (const item of list) {
        const record = item as Record<string, unknown>;
        if (!Number.isInteger(record.id)) return 'id 非 integer';
        if (typeof record.name !== 'string') return 'name 非 string';
        if (!Number.isInteger(record.duplicate_candidate_id)) return 'duplicate_candidate_id 非 integer';
      }
      return null;
    },
  },
  {
    id: 'Event(description required)',
    source: 'mcp_server/src/models/entity_types.py:89 —— stream-v1 就在这里失败（返回 null）',
    prompt: '文本：「小K 在 2026 年 8 月发布了知识图谱功能。」\n'
      + '把它归类为 Event，给出 name 与 description。description 必须是非空字符串，禁止 null。',
    schema: {
      name: 'Event',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    validate: (value) => {
      const record = value as Record<string, unknown>;
      if (record?.description === null) return 'description 为 null（与 stream-v1 完全相同的失败形态）';
      if (typeof record?.name !== 'string') return 'name 非 string';
      if (typeof record?.description !== 'string') return 'description 非 string';
      return null;
    },
  },
  {
    id: 'EdgeTimestamps(nullable)',
    source: 'graphiti_core/prompts/extract_edges.py:59',
    prompt: 'FACT: "小K 在 2026 年 8 月 6 日发布了知识图谱功能"\n'
      + '抽取时间边界，ISO 8601 带 Z。未知则用 null。',
    schema: {
      name: 'EdgeTimestamps',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['valid_at', 'invalid_at'],
        properties: {
          valid_at: { type: ['string', 'null'] },
          invalid_at: { type: ['string', 'null'] },
        },
      },
    },
    validate: (value) => {
      const record = value as Record<string, unknown>;
      for (const key of ['valid_at', 'invalid_at']) {
        const field = record?.[key];
        if (field !== null && typeof field !== 'string') return `${key} 既非 string 也非 null`;
      }
      return null;
    },
  },
];

function loadConfig() {
  const path = join(homedir(), '.xiaok', 'config.json');
  if (!existsSync(path)) throw new Error(`no config at ${path}`);
  return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')));
}

async function callModel(
  binding: { baseUrl?: string; apiKey?: string; wireModel: string; headers?: Record<string, string> },
  contract: Contract,
): Promise<{ ok: boolean; reason: string }> {
  const url = `${binding.baseUrl!.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${binding.apiKey}`,
        ...(binding.headers ?? {}),
      },
      body: JSON.stringify({
        model: binding.wireModel,
        messages: [{ role: 'user', content: contract.prompt }],
        max_tokens: 1200,
        stream: false,
        response_format: { type: 'json_schema', json_schema: contract.schema },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 100)}` };
    }
    const content = JSON.parse(text)?.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: `非 JSON: ${String(content).replace(/\s+/g, ' ').slice(0, 90)}` };
    }
    const problem = contract.validate(parsed);
    return problem ? { ok: false, reason: problem } : { ok: true, reason: 'conforms' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.includes('abort') ? 'timeout 120s' : message.slice(0, 100) };
  } finally {
    clearTimeout(timer);
  }
}

const candidates = process.argv.slice(2);
if (candidates.length === 0) {
  console.error('用法: probe-graphiti-contracts.mts <modelId> [modelId...]');
  process.exit(1);
}

const config = loadConfig();

for (const modelId of candidates) {
  console.log(`\n=== ${modelId} ===`);
  let binding;
  try {
    binding = resolveRuntimeModelBinding(config, modelId);
  } catch (error) {
    console.log(`  无法解析: ${String(error).slice(0, 100)}`);
    continue;
  }
  if (!binding?.baseUrl || !binding?.apiKey) {
    console.log('  跳过：未解析出 baseUrl / apiKey');
    continue;
  }
  let pass = 0;
  for (const contract of CONTRACTS) {
    const outcome = await callModel(binding, contract);
    if (outcome.ok) pass += 1;
    console.log(`  ${outcome.ok ? 'PASS' : 'FAIL'}  ${contract.id.padEnd(26)} ${outcome.ok ? '' : outcome.reason}`);
  }
  console.log(`  → ${pass}/${CONTRACTS.length} 契约通过`);
}
