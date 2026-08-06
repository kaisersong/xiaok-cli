import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const REQUIRED_TOOLS = Object.freeze([
  'add_memory',
  'search_nodes',
  'search_memory_facts',
  'get_episode_entities',
  'get_status',
]);
const FORBIDDEN_TOOLS = Object.freeze([
  'clear_graph',
  'delete_episode',
  'delete_entity_edge',
  'add_triplet',
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaProperties(tool, name) {
  const schema = tool?.inputSchema;
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) {
    throw new Error(`GRAPHITI_EVAL_TOOL_SCHEMA_INVALID:${name}`);
  }
  return schema.properties;
}

function requireProperties(properties, names, toolName) {
  for (const name of names) {
    if (!Object.hasOwn(properties, name)) {
      throw new Error(`GRAPHITI_EVAL_TOOL_SCHEMA_INVALID:${toolName}:${name}`);
    }
  }
}

export function negotiateCapabilities(tools) {
  if (!Array.isArray(tools)) throw new Error('GRAPHITI_EVAL_TOOL_CATALOG_INVALID');
  const byName = new Map(tools.map((tool) => [tool?.name, tool]));
  for (const name of REQUIRED_TOOLS) {
    if (!byName.has(name)) throw new Error(`GRAPHITI_EVAL_REQUIRED_CAPABILITY_MISSING:${name}`);
  }

  const addProperties = schemaProperties(byName.get('add_memory'), 'add_memory');
  requireProperties(addProperties, ['name', 'episode_body', 'group_id', 'uuid', 'reference_time'], 'add_memory');
  const nodeProperties = schemaProperties(byName.get('search_nodes'), 'search_nodes');
  requireProperties(nodeProperties, ['query', 'max_nodes'], 'search_nodes');
  const factProperties = schemaProperties(byName.get('search_memory_facts'), 'search_memory_facts');
  requireProperties(factProperties, ['query', 'max_facts'], 'search_memory_facts');
  const provenanceProperties = schemaProperties(byName.get('get_episode_entities'), 'get_episode_entities');
  requireProperties(provenanceProperties, ['episode_uuids'], 'get_episode_entities');
  schemaProperties(byName.get('get_status'), 'get_status');

  const nodeGroupParameter = Object.hasOwn(nodeProperties, 'group_ids') ? 'group_ids' : 'group_id';
  const factGroupParameter = Object.hasOwn(factProperties, 'group_ids') ? 'group_ids' : 'group_id';
  if (!Object.hasOwn(nodeProperties, nodeGroupParameter)) {
    throw new Error('GRAPHITI_EVAL_TOOL_SCHEMA_INVALID:search_nodes:group');
  }
  if (!Object.hasOwn(factProperties, factGroupParameter)) {
    throw new Error('GRAPHITI_EVAL_TOOL_SCHEMA_INVALID:search_memory_facts:group');
  }

  return Object.freeze({
    advertisedToolNames: Object.freeze([...byName.keys()].filter(Boolean).sort()),
    rejectedTools: Object.freeze(FORBIDDEN_TOOLS.filter((name) => byName.has(name)).sort()),
    nodeGroupParameter,
    factGroupParameter,
  });
}

function parseAuthHeader(raw) {
  if (!raw) return {};
  if (/[\r\n]/u.test(raw)) throw new Error('GRAPHITI_EVAL_AUTH_HEADER_INVALID');
  const separator = raw.indexOf(':');
  if (separator <= 0) throw new Error('GRAPHITI_EVAL_AUTH_HEADER_INVALID');
  const name = raw.slice(0, separator).trim();
  const value = raw.slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || !value) {
    throw new Error('GRAPHITI_EVAL_AUTH_HEADER_INVALID');
  }
  return { [name]: value };
}

async function defaultConnect({ endpoint, headers, timeoutMs = 10_000 }) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: 'xiaok-graphiti-eval', version: '1.0.0' },
    {
      capabilities: {},
      versionNegotiation: {
        mode: 'auto',
        probe: { timeoutMs, maxRetries: 0 },
      },
    },
  );
  await client.connect(transport, { timeout: timeoutMs });
  return {
    listTools: () => client.listTools(undefined, { timeout: timeoutMs }),
    callTool: (request) => client.callTool(request, {
      timeout: 120_000,
      resetTimeoutOnProgress: true,
    }),
    close: () => client.close(),
  };
}

function normalizeToolResult(result) {
  if (!isRecord(result)) throw new Error('GRAPHITI_EVAL_TOOL_RESULT_INVALID');
  if (result.isError === true) throw new Error('GRAPHITI_EVAL_TOOL_CALL_FAILED');
  let value = isRecord(result.structuredContent) ? result.structuredContent : undefined;
  if (!value && Array.isArray(result.content)) {
    const text = result.content
      .filter((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
      .map((entry) => entry.text)
      .join('\n');
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isRecord(parsed)) value = parsed;
      } catch {
        value = { message: text };
      }
    }
  }
  value ??= {};
  if (typeof value.error === 'string' && value.error) throw new Error('GRAPHITI_EVAL_TOOL_RESPONSE_ERROR');
  return value;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function createGuardedGraphitiClient({
  endpoint,
  authHeader,
  groupId,
  audit = () => {},
  connect = defaultConnect,
  now = Date.now,
}) {
  if (typeof groupId !== 'string' || !groupId.startsWith('xiaok-g0-')) {
    throw new Error('GRAPHITI_EVAL_GROUP_ID_INVALID');
  }
  const headers = parseAuthHeader(authHeader);
  const rawClient = await connect({ endpoint, headers });
  let closed = false;

  async function call(tool, args) {
    if (closed) throw new Error('GRAPHITI_EVAL_CLIENT_CLOSED');
    const startedAt = now();
    const baseRecord = {
      timestamp: new Date(startedAt).toISOString(),
      tool,
      groupId,
      argumentKeys: Object.keys(args).sort(),
      ...(typeof args.episode_body === 'string' ? { bodySha256: hashText(args.episode_body) } : {}),
    };
    try {
      const result = normalizeToolResult(await rawClient.callTool({ name: tool, arguments: args }));
      audit(Object.freeze({
        ...baseRecord,
        durationMs: Math.max(0, now() - startedAt),
        outcome: 'ok',
      }));
      return result;
    } catch (error) {
      audit(Object.freeze({
        ...baseRecord,
        durationMs: Math.max(0, now() - startedAt),
        outcome: 'error',
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'GRAPHITI_EVAL_TOOL_CALL_FAILED',
      }));
      throw error;
    }
  }

  try {
    const catalog = await rawClient.listTools();
    const capabilities = negotiateCapabilities(catalog?.tools);
    const status = await call('get_status', {});
    if (status.status !== 'ok') throw new Error('GRAPHITI_EVAL_SERVER_NOT_READY');

    return Object.freeze({
      capabilities,
      initialStatus: Object.freeze({ status: status.status, message: status.message ?? '' }),
      async addEpisode(source) {
        return call('add_memory', {
          name: source.title,
          episode_body: source.body,
          group_id: groupId,
          source: 'text',
          source_description: `xiaok synthetic source ${source.sourceId}`,
          uuid: source.episodeUuid,
          reference_time: source.referenceTime,
          update_communities: false,
        });
      },
      async searchNodes({ query, maxNodes = 10 }) {
        return call('search_nodes', {
          query,
          [capabilities.nodeGroupParameter]: capabilities.nodeGroupParameter === 'group_ids' ? [groupId] : groupId,
          max_nodes: maxNodes,
        });
      },
      async searchFacts({ query, maxFacts = 10 }) {
        return call('search_memory_facts', {
          query,
          [capabilities.factGroupParameter]: capabilities.factGroupParameter === 'group_ids' ? [groupId] : groupId,
          max_facts: maxFacts,
        });
      },
      async getEpisodeProvenance(episodeUuids) {
        return call('get_episode_entities', { episode_uuids: [...episodeUuids] });
      },
      async getStatus() {
        return call('get_status', {});
      },
      async close() {
        if (closed) return;
        closed = true;
        await rawClient.close();
      },
    });
  } catch (error) {
    closed = true;
    await rawClient.close().catch(() => undefined);
    throw error;
  }
}
