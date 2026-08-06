import { createHash } from 'node:crypto';
import { runSubstringBaseline } from './baseline.mjs';
import { createGuardedGraphitiClient } from './client.mjs';
import { createReplicaGroupId, validateFixturePair } from './contracts.mjs';
import { aggregateReplica, qualifyReplicas, scoreQuestion } from './scoring.mjs';

const ALLOWED_AUDIT_TOOLS = new Set([
  'get_status',
  'add_memory',
  'search_nodes',
  'search_memory_facts',
  'get_episodes',
  'get_episode_entities',
]);
const READY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 5_000]);
const READY_MAX_ATTEMPTS = 240;

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error) {
  if (!(error instanceof Error)) return 'GRAPHITI_EVAL_UNKNOWN_FAILURE';
  return error.message.split(':', 1)[0] || 'GRAPHITI_EVAL_UNKNOWN_FAILURE';
}

function createCanarySource(runId, replicaIndex) {
  const digest = createHash('sha256').update(`${runId}:${replicaIndex}`, 'utf8').digest('hex');
  const episodeUuid = `ca00000${replicaIndex}-0000-4000-8000-${digest.slice(0, 12)}`;
  const token = `xiaok-canary-${runId}-r${replicaIndex}-${digest.slice(12, 20)}`;
  return Object.freeze({
    sourceId: `syn-canary-r${replicaIndex}`,
    episodeUuid,
    title: `隔离探针 ${replicaIndex}`,
    body: `IsolationProbe ${token} HAS_STATUS READY. IsolationProbe ${token} BELONGS_TO this evaluation group only.`,
    referenceTime: '2025-12-31T00:00:00Z',
    expectedFacts: [`${token}状态就绪`],
    isInjection: false,
    synthetic: true,
    token,
  });
}

function normalizeFacts(response) {
  if (!Array.isArray(response?.facts)) return [];
  return response.facts.map((fact) => ({
    edgeUuid: typeof fact.uuid === 'string' ? fact.uuid : undefined,
    name: typeof fact.name === 'string' ? fact.name : undefined,
    fact: typeof fact.fact === 'string' ? fact.fact : '',
    text: typeof fact.fact === 'string' ? fact.fact : '',
    groupId: typeof fact.group_id === 'string' ? fact.group_id : undefined,
    episodeUuids: Array.isArray(fact.episodes)
      ? fact.episodes.filter((value) => typeof value === 'string')
      : Array.isArray(fact.episode_uuids)
        ? fact.episode_uuids.filter((value) => typeof value === 'string')
        : [],
    validAt: typeof fact.valid_at === 'string' ? fact.valid_at : null,
    invalidAt: typeof fact.invalid_at === 'string' ? fact.invalid_at : null,
  }));
}

function normalizeNodes(response) {
  if (!Array.isArray(response?.nodes)) return [];
  return response.nodes.map((node) => ({
    nodeUuid: typeof node.uuid === 'string' ? node.uuid : undefined,
    name: typeof node.name === 'string' ? node.name : '',
    summary: typeof node.summary === 'string' ? node.summary : '',
    text: [node.name, node.summary].filter((value) => typeof value === 'string').join('\n'),
    groupId: typeof node.group_id === 'string' ? node.group_id : undefined,
    episodeUuids: [],
  }));
}

function provenanceEdgeUuids(response) {
  return Array.isArray(response?.edges)
    ? response.edges.map((edge) => edge?.uuid).filter((value) => typeof value === 'string')
    : [];
}

function provenanceNodeUuids(response) {
  return Array.isArray(response?.nodes)
    ? response.nodes.map((node) => node?.uuid).filter((value) => typeof value === 'string')
    : [];
}

function discoverEpisodeMap(response, expectedSources, groupId) {
  if (!Array.isArray(response?.episodes)) throw new Error('GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
  const expectedByDescription = new Map(expectedSources.map((source) => [
    `xiaok synthetic source ${source.sourceId}`,
    source.sourceId,
  ]));
  const mapping = {};
  for (const episode of response.episodes) {
    const sourceId = expectedByDescription.get(episode?.source_description);
    if (!sourceId) continue;
    if (episode?.group_id !== groupId || typeof episode?.uuid !== 'string' || !episode.uuid) {
      throw new Error('GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
    }
    if (Object.hasOwn(mapping, sourceId)) throw new Error('GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
    mapping[sourceId] = episode.uuid;
  }
  return Object.freeze({
    complete: Object.keys(mapping).length === expectedSources.length,
    mapping: Object.freeze(mapping),
  });
}

export async function runGraphitiKnowledgeEval({
  runId,
  replicaCount = 3,
  endpoint,
  authHeader,
  clientFactory = createGuardedGraphitiClient,
  corpus,
  questions,
  segment = (value) => value,
  sleep = sleepDefault,
  now = Date.now,
  budgets = {},
}) {
  validateFixturePair(corpus, questions);
  const maxWallMs = budgets.maxWallMs ?? 600_000;
  const maxCalls = budgets.maxCalls ?? 400;
  const maxIngestFailures = budgets.maxIngestFailures ?? 0;
  const startedAtMs = now();
  const audit = [];
  let callCount = 0;
  let ingestFailures = 0;
  let failureCode;
  const states = [];

  function recordAudit(record) {
    callCount += 1;
    audit.push(record);
  }

  function assertBudget() {
    if (callCount >= maxCalls) throw new Error('GRAPHITI_EVAL_CALL_BUDGET_EXHAUSTED');
    if (now() - startedAtMs >= maxWallMs) throw new Error('GRAPHITI_EVAL_WALL_BUDGET_EXHAUSTED');
  }

  async function invoke(operation) {
    assertBudget();
    const result = await operation();
    if (callCount > maxCalls) throw new Error('GRAPHITI_EVAL_CALL_BUDGET_EXHAUSTED');
    if (now() - startedAtMs >= maxWallMs) throw new Error('GRAPHITI_EVAL_WALL_BUDGET_EXHAUSTED');
    return result;
  }

  async function waitUntilReady(state) {
    let mappingComplete = false;
    for (let attempt = 0; attempt < READY_MAX_ATTEMPTS; attempt += 1) {
      const discovered = discoverEpisodeMap(
        await invoke(() => state.client.listEpisodes(corpus.length + 1)),
        [...corpus, state.canary],
        state.groupId,
      );
      if (discovered.complete) {
        mappingComplete = true;
        state.sourceEpisodeMap = discovered.mapping;
        const canaryUuid = discovered.mapping[state.canary.sourceId];
        const provenance = await invoke(() => state.client.getEpisodeProvenance([canaryUuid]));
        if ((provenance?.nodes?.length ?? 0) > 0 || (provenance?.edges?.length ?? 0) > 0) {
          const canaryHits = normalizeNodes(await invoke(() => state.client.searchNodes({
            query: state.canary.token,
            maxNodes: 5,
          })));
          const provenanceNodes = provenanceNodeUuids(provenance);
          const ownCanaryVisible = canaryHits.some((hit) => (
            hit.groupId === state.groupId
            && provenanceNodes.includes(hit.nodeUuid)
            && hit.text.includes(state.canary.token)
          ));
          if (ownCanaryVisible) return;
        }
      }
      if (attempt === READY_MAX_ATTEMPTS - 1) {
        throw new Error(mappingComplete
          ? 'GRAPHITI_EVAL_INGESTION_NOT_READY'
          : 'GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
      }
      await sleep(READY_DELAYS_MS[Math.min(attempt, READY_DELAYS_MS.length - 1)]);
      assertBudget();
    }
  }

  try {
    for (let replicaIndex = 1; replicaIndex <= replicaCount; replicaIndex += 1) {
      assertBudget();
      const groupId = createReplicaGroupId(runId, replicaIndex);
      const canary = createCanarySource(runId, replicaIndex);
      const state = {
        replicaIndex,
        groupId,
        canary,
        client: null,
        baselineScores: [],
        graphScores: [],
        sourceEpisodeMap: undefined,
        completed: false,
      };
      states.push(state);
      state.client = await clientFactory({ endpoint, authHeader, groupId, audit: recordAudit });
      if (callCount > maxCalls) throw new Error('GRAPHITI_EVAL_CALL_BUDGET_EXHAUSTED');

      for (const source of [...corpus, canary]) {
        try {
          await invoke(() => state.client.addEpisode(source));
        } catch (error) {
          const code = errorCode(error);
          if (code === 'GRAPHITI_EVAL_CALL_BUDGET_EXHAUSTED' || code === 'GRAPHITI_EVAL_WALL_BUDGET_EXHAUSTED') {
            throw error;
          }
          ingestFailures += 1;
          if (ingestFailures > maxIngestFailures) throw new Error('GRAPHITI_EVAL_INGESTION_FAILED', { cause: error });
        }
      }
      if (ingestFailures > 0) throw new Error('GRAPHITI_EVAL_INGESTION_FAILED');
      await waitUntilReady(state);
    }

    for (const state of states) {
      const sourceEpisodeMap = state.sourceEpisodeMap;
      if (!sourceEpisodeMap) throw new Error('GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
      for (const question of questions) {
        const baselineHits = runSubstringBaseline({
          sources: corpus,
          query: question.query,
          topK: question.topK,
          segment,
        });
        state.baselineScores.push(scoreQuestion(question, baselineHits, {
          mode: 'baseline',
          sourceEpisodeMap,
        }));

        const factResponse = await invoke(() => state.client.searchFacts({
          query: question.query,
          maxFacts: question.topK,
        }));
        const graphHits = normalizeFacts(factResponse);
        if (question.category === 'alias') {
          const nodeResponse = await invoke(() => state.client.searchNodes({
            query: question.query,
            maxNodes: question.topK,
          }));
          graphHits.push(...normalizeNodes(nodeResponse));
        }
        const groupMismatches = graphHits.filter((hit) => hit.groupId !== state.groupId);
        if (groupMismatches.length > 0) {
          state.crossGroupLeaks ??= [];
          state.crossGroupLeaks.push({
            questionId: question.id,
            mismatchCount: groupMismatches.length,
          });
        }
        if (question.category === 'provenance') {
          const episodeUuids = question.expectedSourceIds.map((sourceId) => sourceEpisodeMap[sourceId]);
          const provenance = await invoke(() => state.client.getEpisodeProvenance(episodeUuids));
          const edgeUuids = provenanceEdgeUuids(provenance);
          for (const hit of graphHits) hit.provenanceEdgeUuids = edgeUuids;
        }
        state.graphScores.push(scoreQuestion(question, graphHits, {
          mode: 'graph',
          sourceEpisodeMap,
        }));
      }
      state.completed = true;
    }

    for (const state of states) {
      for (const other of states) {
        if (other === state) continue;
        const response = await invoke(() => state.client.searchNodes({
          query: other.canary.token,
          maxNodes: 5,
        }));
        state.crossGroupLeaks ??= [];
        if (normalizeNodes(response).length > 0) {
          state.crossGroupLeaks.push({ otherReplicaIndex: other.replicaIndex });
        }
      }
    }
  } catch (error) {
    failureCode = errorCode(error);
  } finally {
    await Promise.all(states.map((state) => state.client?.close().catch(() => undefined)));
  }

  const replicas = states.map((state) => ({
    replicaIndex: state.replicaIndex,
    groupId: state.groupId,
    capabilities: state.client?.capabilities,
    initialStatus: state.client?.initialStatus,
    sourceEpisodeMap: state.sourceEpisodeMap,
    canaryTokenSha256: createHash('sha256').update(state.canary.token, 'utf8').digest('hex'),
    crossGroupLeaks: state.crossGroupLeaks ?? [],
    baselineScores: state.baselineScores,
    graphScores: state.graphScores,
    ...aggregateReplica({
      completed: state.completed,
      baselineScores: state.baselineScores,
      graphScores: state.graphScores,
      failureCode: state.completed ? undefined : failureCode,
    }),
  }));
  const safety = Object.freeze({
    unauthorizedMutationCount: audit.filter((record) => !ALLOWED_AUDIT_TOOLS.has(record.tool)).length,
    crossGroupLeakCount: replicas.reduce((sum, replica) => sum + replica.crossGroupLeaks.length, 0),
  });
  const qualification = qualifyReplicas(replicas, safety);

  return Object.freeze({
    schemaVersion: 1,
    runId,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(now()).toISOString(),
    callCount,
    ingestFailures,
    ...(failureCode ? { failureCode } : {}),
    audit: Object.freeze(audit),
    replicas: Object.freeze(replicas),
    safety,
    qualification,
  });
}
