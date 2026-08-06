import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const evalRoot = join(process.cwd(), 'scripts', 'evals', 'graphiti-knowledge');
let runGraphitiKnowledgeEval: any;
let corpus: any[];
let questions: any[];

beforeAll(async () => {
  const runner = await import(pathToFileURL(join(evalRoot, 'runner.mjs')).href);
  const contracts = await import(pathToFileURL(join(evalRoot, 'contracts.mjs')).href);
  runGraphitiKnowledgeEval = runner.runGraphitiKnowledgeEval;
  corpus = await contracts.loadCorpus(join(evalRoot, 'fixtures', 'corpus.json'));
  questions = await contracts.loadQuestions(join(evalRoot, 'fixtures', 'questions.json'));
});

function createFakeGraphiti({
  readyAfter = 1,
  crossLeak = false,
  wrongGroupFacts = false,
  missingEpisode = false,
  duplicateEpisode = false,
  wrongGroupEpisodes = false,
} = {}) {
  const calls: any[] = [];
  const data = new Map<string, any[]>();
  const provenancePolls = new Map<string, number>();
  const sourceById = new Map(corpus.map((source) => [source.sourceId, source]));

  function actualEpisodeUuid(groupId: string, sourceId: string) {
    return `actual-${groupId}-${sourceId}`;
  }

  function record(audit: (record: any) => void, groupId: string, tool: string, args: any = {}) {
    const call = { groupId, tool, args };
    calls.push(call);
    audit({ tool, groupId, outcome: 'ok', argumentKeys: Object.keys(args).sort() });
    return call;
  }

  return {
    calls,
    groups: () => [...data.keys()],
    clientFactory: async ({ groupId, audit }: any) => {
      data.set(groupId, []);
      record(audit, groupId, 'get_status');
      return {
        capabilities: { advertisedToolNames: ['add_memory', 'get_episode_entities', 'get_episodes', 'get_status', 'search_memory_facts', 'search_nodes'], rejectedTools: [] },
        initialStatus: { status: 'ok', message: 'ready' },
        async addEpisode(source: any) {
          record(audit, groupId, 'add_memory', { sourceId: source.sourceId });
          data.get(groupId)!.push(source);
          return { message: 'queued' };
        },
        async listEpisodes() {
          record(audit, groupId, 'get_episodes', {});
          const episodes = data.get(groupId)!
            .filter((source) => !(missingEpisode && source.sourceId === corpus[0].sourceId))
            .map((source) => ({
              uuid: actualEpisodeUuid(groupId, source.sourceId),
              source_description: `xiaok synthetic source ${source.sourceId}`,
              group_id: wrongGroupEpisodes ? 'unexpected-group' : groupId,
            }));
          if (duplicateEpisode && episodes[0]) episodes.push({ ...episodes[0], uuid: `${episodes[0].uuid}-duplicate` });
          return { episodes };
        },
        async getEpisodeProvenance(episodeUuids: string[]) {
          record(audit, groupId, 'get_episode_entities', { episodeUuids });
          const isCanary = episodeUuids.some((uuid) => uuid.includes('syn-canary-'));
          if (isCanary) {
            const count = (provenancePolls.get(groupId) ?? 0) + 1;
            provenancePolls.set(groupId, count);
            if (count < readyAfter) return { nodes: [], edges: [] };
          }
          return {
            nodes: episodeUuids.map((uuid) => ({ uuid: `node-${uuid}`, group_id: groupId })),
            edges: episodeUuids.map((uuid) => ({ uuid: `edge-${uuid}`, group_id: groupId })),
          };
        },
        async searchFacts({ query }: any) {
          record(audit, groupId, 'search_memory_facts', { query });
          if (query.startsWith('xiaok-canary-')) {
            const own = data.get(groupId)!.find((source) => source.body.includes(query));
            if (own) {
              const episodeUuid = actualEpisodeUuid(groupId, own.sourceId);
              return { facts: [{ uuid: `edge-${episodeUuid}`, fact: query, episodes: [episodeUuid], group_id: groupId }] };
            }
            if (crossLeak) {
              return { facts: [{ uuid: 'leaked-edge', fact: query, episodes: ['leaked-episode'], group_id: 'another-group' }] };
            }
            return { facts: [] };
          }
          const question = questions.find((item) => item.query === query);
          if (!question) return { facts: [] };
          return {
            facts: question.expectedSourceIds.map((sourceId: string) => {
              const source = sourceById.get(sourceId)!;
              return {
                uuid: `edge-${actualEpisodeUuid(groupId, source.sourceId)}`,
                fact: `${question.expectedAnyTerms[0]} ${question.query}`,
                episodes: [actualEpisodeUuid(groupId, source.sourceId)],
                group_id: wrongGroupFacts ? 'unexpected-group' : groupId,
                valid_at: '2020-01-01T00:00:00Z',
                invalid_at: null,
              };
            }),
          };
        },
        async searchNodes({ query }: any) {
          record(audit, groupId, 'search_nodes', { query });
          return { nodes: [] };
        },
        async close() {
          calls.push({ groupId, tool: 'close', args: {} });
        },
      };
    },
  };
}

function options(fake: ReturnType<typeof createFakeGraphiti>, patch: Record<string, unknown> = {}) {
  return {
    runId: '20260806-fixed',
    replicaCount: 3,
    clientFactory: fake.clientFactory,
    corpus,
    questions,
    segment: (value: string) => value,
    sleep: async () => {},
    budgets: { maxWallMs: 30_000, maxCalls: 1000, maxIngestFailures: 0 },
    ...patch,
  };
}

describe('Graphiti knowledge evaluation runner', () => {
  it('uses exactly three isolated groups and never calls a forbidden mutation', async () => {
    const fake = createFakeGraphiti();
    const report = await runGraphitiKnowledgeEval(options(fake));

    expect(fake.groups()).toEqual([
      'xiaok-g0-20260806-fixed-r1',
      'xiaok-g0-20260806-fixed-r2',
      'xiaok-g0-20260806-fixed-r3',
    ]);
    expect(report.replicas).toHaveLength(3);
    expect(fake.calls.some((call) => ['clear_graph', 'delete_episode', 'delete_entity_edge', 'add_triplet'].includes(call.tool)))
      .toBe(false);
  });

  it('preserves each replica capability snapshot for evidence', async () => {
    const fake = createFakeGraphiti();
    const report = await runGraphitiKnowledgeEval(options(fake));

    expect(report.replicas).toHaveLength(3);
    for (const replica of report.replicas) {
      expect(replica.capabilities).toEqual({
        advertisedToolNames: ['add_memory', 'get_episode_entities', 'get_episodes', 'get_status', 'search_memory_facts', 'search_nodes'],
        rejectedTools: [],
      });
      expect(replica.initialStatus).toEqual({ status: 'ok', message: 'ready' });
    }
  });

  it('waits for the last canary provenance before issuing scored queries', async () => {
    const fake = createFakeGraphiti({ readyAfter: 3 });
    await runGraphitiKnowledgeEval(options(fake));

    for (const groupId of fake.groups()) {
      const groupCalls = fake.calls.filter((call) => call.groupId === groupId);
      const firstScoredSearch = groupCalls.findIndex((call) => call.tool === 'search_memory_facts' && !call.args.query.startsWith('xiaok-canary-'));
      const provenanceBeforeSearch = groupCalls
        .slice(0, firstScoredSearch)
        .filter((call) => call.tool === 'get_episode_entities');
      expect(provenanceBeforeSearch).toHaveLength(3);
    }
  });

  it('returns INCOMPLETE when the call budget is exhausted', async () => {
    const fake = createFakeGraphiti();
    const report = await runGraphitiKnowledgeEval(options(fake, {
      budgets: { maxWallMs: 30_000, maxCalls: 5, maxIngestFailures: 0 },
    }));

    expect(report.qualification).toMatchObject({ recommendation: 'INCOMPLETE' });
    expect(report.failureCode).toBe('GRAPHITI_EVAL_CALL_BUDGET_EXHAUSTED');
    expect(fake.calls.filter((call) => call.tool !== 'close').length).toBeLessThanOrEqual(5);
  });

  it.each([
    ['missing', { missingEpisode: true }],
    ['duplicate', { duplicateEpisode: true }],
    ['cross-group', { wrongGroupEpisodes: true }],
  ])('fails closed when discovered episode identities are %s', async (_name, fakeOptions) => {
    const fake = createFakeGraphiti(fakeOptions);
    const report = await runGraphitiKnowledgeEval(options(fake));

    expect(report.qualification).toMatchObject({ recommendation: 'INCOMPLETE' });
    expect(report.failureCode).toBe('GRAPHITI_EVAL_EPISODE_MAPPING_INVALID');
  });

  it('returns NO_GO when a replica can see another group canary', async () => {
    const fake = createFakeGraphiti({ crossLeak: true });
    const report = await runGraphitiKnowledgeEval(options(fake));

    expect(report.safety.crossGroupLeakCount).toBeGreaterThan(0);
    expect(report.qualification).toMatchObject({ recommendation: 'NO_GO' });
  });

  it('returns NO_GO when a scored fact claims another group', async () => {
    const fake = createFakeGraphiti({ wrongGroupFacts: true });
    const report = await runGraphitiKnowledgeEval(options(fake));

    expect(report.safety.crossGroupLeakCount).toBeGreaterThan(0);
    expect(report.qualification).toMatchObject({ recommendation: 'NO_GO' });
  });

  it('treats prompt injection only as add_memory episode content', async () => {
    const fake = createFakeGraphiti();
    await runGraphitiKnowledgeEval(options(fake));

    const injectionAdds = fake.calls.filter((call) => call.tool === 'add_memory' && call.args.sourceId === 'syn-injection-drill');
    expect(injectionAdds).toHaveLength(3);
    expect(fake.calls.some((call) => call.tool === 'clear_graph' || call.tool === 'add_triplet')).toBe(false);
  });
});
