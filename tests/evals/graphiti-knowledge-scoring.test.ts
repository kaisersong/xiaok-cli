import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

let scoreQuestion: any;
let aggregateReplica: any;
let qualifyReplicas: any;

beforeAll(async () => {
  const module = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/graphiti-knowledge/scoring.mjs',
  )).href);
  scoreQuestion = module.scoreQuestion;
  aggregateReplica = module.aggregateReplica;
  qualifyReplicas = module.qualifyReplicas;
});

const sourceEpisodeMap = {
  'syn-a': '10000000-0000-4000-8000-000000000001',
  'syn-b': '10000000-0000-4000-8000-000000000002',
};

function question(patch: Record<string, unknown> = {}) {
  return {
    id: 'alias-01',
    category: 'alias',
    query: '星桥计划',
    expectedAnyTerms: ['星桥计划'],
    expectedSourceIds: ['syn-a'],
    topK: 10,
    ...patch,
  };
}

function ratio(accuracy: number) {
  return { correct: accuracy * 10000, total: 10000, accuracy };
}

function replica(patch: Record<string, any> = {}) {
  return {
    completed: true,
    questionCount: 30,
    baselineQuestionCount: 30,
    graphTargeted: ratio(0.85),
    baselineGraphTargeted: ratio(0.70),
    temporal: ratio(0.90),
    provenance: ratio(1),
    control: ratio(0.80),
    baselineControl: ratio(0.80),
    ...patch,
  };
}

describe('Graphiti deterministic question scoring', () => {
  it('requires both expected terms and expected source coverage', () => {
    expect(scoreQuestion(question(), [{
      text: '星桥计划也叫 Project Starbridge',
      sourceIds: ['syn-a'],
    }], { mode: 'baseline', sourceEpisodeMap })).toMatchObject({
      correct: true,
      termMatch: true,
      sourceMatch: true,
    });

    expect(scoreQuestion(question(), [{
      text: '星桥计划也叫 Project Starbridge',
      sourceIds: ['syn-b'],
    }], { mode: 'baseline', sourceEpisodeMap })).toMatchObject({
      correct: false,
      termMatch: true,
      sourceMatch: false,
    });
  });

  it('requires search edge to episode to provenance edge binding', () => {
    const provenanceQuestion = question({ category: 'provenance', id: 'provenance-01' });
    const baseHit = {
      text: '星桥计划也叫 Project Starbridge',
      edgeUuid: 'edge-search-1',
      episodeUuids: [sourceEpisodeMap['syn-a']],
    };

    expect(scoreQuestion(provenanceQuestion, [{
      ...baseHit,
      provenanceEdgeUuids: ['edge-search-1'],
    }], { mode: 'graph', sourceEpisodeMap })).toMatchObject({
      correct: true,
      provenanceMatch: true,
    });

    expect(scoreQuestion(provenanceQuestion, [{
      ...baseHit,
      provenanceEdgeUuids: ['different-edge'],
    }], { mode: 'graph', sourceEpisodeMap })).toMatchObject({
      correct: false,
      provenanceMatch: false,
    });
  });

  it('rejects a temporal fact outside its validity interval', () => {
    const temporalQuestion = question({
      id: 'temporal-01',
      category: 'temporal',
      validAt: '2025-07-01T00:00:00Z',
    });
    const hit = {
      text: '林澄负责星桥计划',
      episodeUuids: [sourceEpisodeMap['syn-a']],
      validAt: '2025-01-10T00:00:00Z',
      invalidAt: '2025-06-15T00:00:00Z',
    };

    expect(scoreQuestion(temporalQuestion, [hit], { mode: 'graph', sourceEpisodeMap }))
      .toMatchObject({ correct: false, temporalMatch: false });
  });

  it('aggregates all five categories without dropping failed questions', () => {
    const categories = ['alias', 'multi_hop', 'temporal', 'provenance', 'control'];
    const baselineScores = categories.flatMap((category) => Array.from({ length: 6 }, (_, index) => ({
      questionId: `${category}-${index}`,
      category,
      correct: index < 3,
    })));
    const graphScores = categories.flatMap((category) => Array.from({ length: 6 }, (_, index) => ({
      questionId: `${category}-${index}`,
      category,
      correct: index < 5,
    })));

    expect(aggregateReplica({ completed: true, baselineScores, graphScores })).toMatchObject({
      completed: true,
      questionCount: 30,
      baselineQuestionCount: 30,
      control: { correct: 5, total: 6 },
      baselineControl: { correct: 3, total: 6 },
      graphTargeted: { correct: 20, total: 24 },
      baselineGraphTargeted: { correct: 12, total: 24 },
    });
  });
});

describe('Graphiti three-replica qualification', () => {
  it('returns GO at the exact 15 percentage-point boundary', () => {
    expect(qualifyReplicas([
      replica(),
      replica(),
      replica(),
    ], { unauthorizedMutationCount: 0, crossGroupLeakCount: 0 })).toMatchObject({
      recommendation: 'GO',
    });
  });

  it('returns NO_GO at 14.99 percentage points', () => {
    expect(qualifyReplicas([
      replica({ graphTargeted: ratio(0.8499) }),
      replica({ graphTargeted: ratio(0.8499) }),
      replica({ graphTargeted: ratio(0.8499) }),
    ], { unauthorizedMutationCount: 0, crossGroupLeakCount: 0 })).toMatchObject({
      recommendation: 'NO_GO',
      reasons: expect.arrayContaining(['GRAPH_TARGETED_GAIN_BELOW_15PP']),
    });
  });

  it.each([
    ['provenance below 100%', { provenance: ratio(0.99) }, {}],
    ['temporal below 90%', { temporal: ratio(0.8999) }, {}],
    ['control below baseline', { control: ratio(0.79) }, {}],
    ['one unauthorized mutation', {}, { unauthorizedMutationCount: 1 }],
    ['one cross-group canary leak', {}, { crossGroupLeakCount: 1 }],
  ])('%s returns NO_GO', (_name, metricPatch, safetyPatch) => {
    expect(qualifyReplicas([
      replica(metricPatch),
      replica(metricPatch),
      replica(metricPatch),
    ], { unauthorizedMutationCount: 0, crossGroupLeakCount: 0, ...safetyPatch }).recommendation)
      .toBe('NO_GO');
  });

  it('returns INCOMPLETE rather than NO_GO when any replica is incomplete', () => {
    expect(qualifyReplicas([
      replica(),
      replica({ completed: false, questionCount: 12 }),
      replica(),
    ], { unauthorizedMutationCount: 0, crossGroupLeakCount: 0 })).toMatchObject({
      recommendation: 'INCOMPLETE',
      reasons: expect.arrayContaining(['QUALIFICATION_REQUIRES_THREE_COMPLETE_REPLICAS']),
    });
  });
});
