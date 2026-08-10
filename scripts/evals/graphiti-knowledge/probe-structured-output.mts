/**
 * Probe which configured provider endpoints actually honour the structured
 * output contract Graphiti needs.
 *
 * Graphiti asks for native `response_format: { type: 'json_schema' }` with a
 * strict Pydantic-derived schema. A provider that only supports `json_object`
 * returns JSON but gives no guarantee about field nesting or types — which is
 * exactly how the 2026-08-07 DeepSeek G0 runs failed.
 *
 * Sends one tiny request per model. Prints acceptance and conformance only,
 * never credentials.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeModelBinding } from '/Users/song/projects/xiaok-cli/src/ai/providers/control-plane.js';
import { normalizeConfig } from '/Users/song/projects/xiaok-cli/src/ai/providers/normalize.js';

// Mirrors the shape Graphiti requires for its simplest extraction step.
const SCHEMA = {
  name: 'extracted_entities',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['entities'],
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description'],
          properties: {
            name: { type: 'string' },
            // Graphiti's Event.description is a required string. DeepSeek
            // returned null here, which is what broke stream-v1.
            description: { type: 'string' },
          },
        },
      },
    },
  },
};

const PROMPT = '从这句话抽取实体：小K 在 2026 年发布了知识图谱功能。只输出 JSON。';

function loadConfig() {
  const path = join(homedir(), '.xiaok', 'config.json');
  if (!existsSync(path)) throw new Error(`no config at ${path}`);
  return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')));
}

async function probe(modelId: string, binding: ReturnType<typeof resolveRuntimeModelBinding>) {
  if (!binding?.baseUrl || !binding?.apiKey) {
    return { modelId, status: 'skipped', detail: 'no baseUrl/apiKey resolved' };
  }
  const url = `${binding.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: binding.wireModel,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: 300,
    stream: false,
    response_format: { type: 'json_schema', json_schema: SCHEMA },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${binding.apiKey}`,
        ...(binding.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 140);
      return { modelId, status: 'rejected_json_schema', detail: `HTTP ${response.status}: ${snippet}` };
    }
    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { modelId, status: 'accepted_but_not_json', detail: String(content).slice(0, 120) };
    }
    const entities = (parsed as { entities?: unknown })?.entities;
    if (!Array.isArray(entities)) {
      return { modelId, status: 'schema_violation', detail: 'entities is not an array' };
    }
    const bad = entities.find((entity) => {
      const record = entity as Record<string, unknown>;
      return typeof record?.name !== 'string' || typeof record?.description !== 'string';
    });
    if (bad) {
      return { modelId, status: 'schema_violation', detail: `bad item: ${JSON.stringify(bad).slice(0, 120)}` };
    }
    return { modelId, status: 'conforms', detail: `${entities.length} entities` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { modelId, status: message.includes('abort') ? 'timeout_60s' : 'error', detail: message.slice(0, 140) };
  } finally {
    clearTimeout(timer);
  }
}

const config = loadConfig();
const modelIds = Object.keys(config.models ?? {});
const results: Array<{ modelId: string; status: string; detail: string }> = [];

for (const modelId of modelIds) {
  let binding;
  try {
    binding = resolveRuntimeModelBinding(config, modelId);
  } catch (error) {
    results.push({ modelId, status: 'unresolvable', detail: String(error).slice(0, 100) });
    continue;
  }
  if (binding?.protocol === 'anthropic') {
    results.push({ modelId, status: 'skipped', detail: 'anthropic protocol — Graphiti uses its own AnthropicClient' });
    continue;
  }
  const outcome = await probe(modelId, binding);
  results.push(outcome as { modelId: string; status: string; detail: string });
  console.log(`${outcome.status.padEnd(24)} ${modelId.padEnd(26)} ${outcome.detail ?? ''}`);
}

console.log('\n--- 汇总 ---');
const conforming = results.filter((r) => r.status === 'conforms');
console.log(`原生 json_schema 且输出合规: ${conforming.length ? conforming.map((r) => r.modelId).join(', ') : '(无)'}`);
for (const status of ['rejected_json_schema', 'schema_violation', 'timeout_60s', 'accepted_but_not_json', 'error', 'skipped', 'unresolvable']) {
  const group = results.filter((r) => r.status === status);
  if (group.length) console.log(`${status}: ${group.map((r) => r.modelId).join(', ')}`);
}
