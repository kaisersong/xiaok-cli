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
  'get_episode_entities',
]);
const READY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 5_000, 5_000, 5_000]);

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
    body: `隔离探针 ${token} 的状态是就绪。该探针只属于当前评测分组。`,
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
    for (let attempt = 0; attempt <= READY_DELAYS_MS.length; attempt += 1) {
      const provenance = await invoke(() => state.client.getEpisodeProvenance([state.canary.episodeUuid]));
      if ((provenance?.nodes?.length ?? 0) > 0 || (provenance?.edges?.length ?? 0) > 0) return;
      if (attempt === READY_DELAYS_MS.length) throw new Error('GRAPHITI_EVAL_INGESTION_NOT_READY');
      await sleep(READY_DELAYS_MS[attempt]);
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

    const sourceEpisodeMap = Object.fromEntries(corpus.map((source) => [source.sourceId, source.episodeUuid]));
    for (const state of states) {
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
        const response = await invoke(() => state.client.searchFacts({
          query: other.canary.token,
          maxFacts: 5,
        }));
        state.crossGroupLeaks ??= [];
        if (normalizeFacts(response).length > 0) {
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
