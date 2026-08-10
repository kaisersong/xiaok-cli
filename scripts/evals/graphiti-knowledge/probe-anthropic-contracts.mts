/**
 * Probe the Anthropic-protocol endpoint against the same six Graphiti contracts.
 *
 * Graphiti's AnthropicClient does not use OpenAI's response_format. It forces a
 * single tool call whose input_schema is the Pydantic-derived JSON Schema, then
 * reads the tool input as the structured result. This probe replicates that
 * mechanism so the comparison against the OpenAI-path models is fair.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeModelBinding } from '/Users/song/projects/xiaok-cli/src/ai/providers/control-plane.js';

const isIntArray = (v: unknown) => Array.isArray(v) && v.every((x) => Number.isInteger(x));

const CONTRACTS = [
  {
    id: 'ExtractedEntities',
    prompt: '文本：「小K 在 2026 年发布了知识图谱功能，由张伟负责。」\nentity_type_id 可选值：0=Person, 1=Organization, 2=Event。抽取实体。',
    schema: {
      type: 'object',
      required: ['extracted_entities'],
      properties: {
        extracted_entities: {
          type: 'array',
          items: {
            type: 'object',
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
    validate: (v: any) => {
      if (!Array.isArray(v?.extracted_entities) || v.extracted_entities.length === 0) return 'extracted_entities 空或非数组';
      for (const e of v.extracted_entities) {
        if (typeof e?.name !== 'string') return 'name 非 string';
        if (!Number.isInteger(e?.entity_type_id)) return 'entity_type_id 非 integer';
        if (!isIntArray(e?.episode_indices)) return 'episode_indices 非 int[]';
      }
      return null;
    },
  },
  {
    id: 'ExtractedEdges',
    prompt: 'ENTITIES: ["小K", "张伟", "知识图谱功能"]\n文本：「小K 在 2026 年发布了知识图谱功能，由张伟负责。」抽取实体间关系。',
    schema: {
      type: 'object',
      required: ['edges'],
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
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
    validate: (v: any) => {
      if (!Array.isArray(v?.edges) || v.edges.length === 0) return 'edges 空或非数组';
      for (const e of v.edges) {
        for (const k of ['source_entity_name', 'target_entity_name', 'relation_type', 'fact']) {
          if (typeof e?.[k] !== 'string') return `${k} 非 string`;
        }
      }
      return null;
    },
  },
  {
    id: 'EdgeDuplicate',
    prompt: 'NEW FACT: "小K 发布了知识图谱功能"\nEXISTING FACTS:\n  idx 0: "小K 上线了知识图谱能力"\n  idx 1: "张伟离职了"\n判断 NEW FACT 与哪些 EXISTING FACTS 重复或矛盾。',
    schema: {
      type: 'object',
      required: ['duplicate_facts', 'contradicted_facts'],
      properties: {
        duplicate_facts: { type: 'array', items: { type: 'integer' } },
        contradicted_facts: { type: 'array', items: { type: 'integer' } },
      },
    },
    validate: (v: any) => {
      if (v?.properties && !('duplicate_facts' in v)) return '字段被包进 properties';
      if (!isIntArray(v?.duplicate_facts)) return 'duplicate_facts 非 int[]';
      if (!isIntArray(v?.contradicted_facts)) return 'contradicted_facts 非 int[]';
      return null;
    },
  },
  {
    id: 'NodeResolutions',
    prompt: 'ENTITIES:\n  id 0: "小K"\n  id 1: "张伟"\nEXISTING ENTITIES:\n  candidate_id 10: "小K（产品）"\n为每个 ENTITY 给出重复判定，无重复用 -1。',
    schema: {
      type: 'object',
      required: ['entity_resolutions'],
      properties: {
        entity_resolutions: {
          type: 'array',
          items: {
            type: 'object',
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
    validate: (v: any) => {
      if (!Array.isArray(v?.entity_resolutions) || v.entity_resolutions.length === 0) return 'entity_resolutions 空或非数组';
      for (const e of v.entity_resolutions) {
        if (!Number.isInteger(e?.id)) return 'id 非 integer';
        if (typeof e?.name !== 'string') return 'name 非 string';
        if (!Number.isInteger(e?.duplicate_candidate_id)) return 'duplicate_candidate_id 非 integer';
      }
      return null;
    },
  },
  {
    id: 'Event(description required)',
    prompt: '文本：「小K 在 2026 年 8 月发布了知识图谱功能。」\n把它归类为 Event，给出 name 与 description。description 必须是非空字符串，禁止 null。',
    schema: {
      type: 'object',
      required: ['name', 'description'],
      properties: { name: { type: 'string' }, description: { type: 'string' } },
    },
    validate: (v: any) => {
      if (v?.description === null) return 'description 为 null';
      if (typeof v?.name !== 'string') return 'name 非 string';
      if (typeof v?.description !== 'string') return 'description 非 string';
      return null;
    },
  },
  {
    id: 'EdgeTimestamps(nullable)',
    prompt: 'FACT: "小K 在 2026 年 8 月 6 日发布了知识图谱功能"\n抽取时间边界，ISO 8601 带 Z。未知则用 null。',
    schema: {
      type: 'object',
      required: ['valid_at', 'invalid_at'],
      properties: {
        valid_at: { type: ['string', 'null'] },
        invalid_at: { type: ['string', 'null'] },
      },
    },
    validate: (v: any) => {
      for (const k of ['valid_at', 'invalid_at']) {
        if (v?.[k] !== null && typeof v?.[k] !== 'string') return `${k} 既非 string 也非 null`;
      }
      return null;
    },
  },
];

const modelId = process.argv[2] ?? 'claude-ccr-default';
const cfg = JSON.parse(readFileSync(join(homedir(), '.xiaok', 'config.json'), 'utf8'));
const binding = resolveRuntimeModelBinding(cfg, modelId);

if (!binding?.baseUrl || !binding?.apiKey) {
  console.error(`${modelId} 未解析出 baseUrl / apiKey`);
  process.exit(1);
}

const url = `${binding.baseUrl.replace(/\/$/, '')}/v1/messages`;
console.log(`=== ${modelId} (anthropic tool-use) ===`);
console.log(`endpoint: ${url}  wire: ${binding.wireModel}`);

let pass = 0;
for (const contract of CONTRACTS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let outcome = { ok: false, reason: '' };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': binding.apiKey,
        'anthropic-version': '2023-06-01',
        authorization: `Bearer ${binding.apiKey}`,
      },
      body: JSON.stringify({
        model: binding.wireModel,
        max_tokens: 1500,
        // Graphiti 的 AnthropicClient 就是这样强制结构化：单一 tool + input_schema
        tools: [{ name: 'emit_result', description: '返回结构化结果', input_schema: contract.schema }],
        tool_choice: { type: 'tool', name: 'emit_result' },
        messages: [{ role: 'user', content: contract.prompt }],
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      outcome = { ok: false, reason: `HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 110)}` };
    } else {
      const payload = JSON.parse(text);
      const block = (payload?.content ?? []).find((b: any) => b?.type === 'tool_use');
      if (!block) {
        outcome = { ok: false, reason: `无 tool_use 块: ${JSON.stringify(payload?.content ?? payload).slice(0, 110)}` };
      } else {
        const problem = contract.validate(block.input);
        outcome = problem ? { ok: false, reason: problem } : { ok: true, reason: 'conforms' };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome = { ok: false, reason: message.includes('abort') ? 'timeout 120s' : message.slice(0, 110) };
  } finally {
    clearTimeout(timer);
  }
  if (outcome.ok) pass += 1;
  console.log(`  ${outcome.ok ? 'PASS' : 'FAIL'}  ${contract.id.padEnd(26)} ${outcome.ok ? '' : outcome.reason}`);
}
console.log(`  → ${pass}/${CONTRACTS.length} 契约通过`);
