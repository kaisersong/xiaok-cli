import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

let tokenizeBaseline: any;
let runSubstringBaseline: any;
let loadCorpus: any;
let loadQuestions: any;
let scoreQuestion: any;
let segmentQuery: any;

beforeAll(async () => {
  const module = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/graphiti-knowledge/baseline.mjs',
  )).href);
  tokenizeBaseline = module.tokenizeBaseline;
  runSubstringBaseline = module.runSubstringBaseline;
  const contracts = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/graphiti-knowledge/contracts.mjs',
  )).href);
  const scoring = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/graphiti-knowledge/scoring.mjs',
  )).href);
  const segment = await import(pathToFileURL(join(
    process.cwd(),
    'src/ai/memory/segment.ts',
  )).href);
  loadCorpus = contracts.loadCorpus;
  loadQuestions = contracts.loadQuestions;
  scoreQuestion = scoring.scoreQuestion;
  segmentQuery = segment.segmentQuery;
});

describe('Graphiti evaluation production substring baseline', () => {
  it('deduplicates segmented terms and matches case-insensitively', () => {
    expect(tokenizeBaseline('PROJECT 负责人 负责人', (value: string) => value))
      .toEqual(['project', '负责人']);

    expect(runSubstringBaseline({
      sources: [{
        sourceId: 's1',
        title: 'A',
        body: 'Project Starbridge 负责人是林澄',
      }],
      query: 'PROJECT 负责人 负责人',
      topK: 10,
      segment: (value: string) => value,
    })).toMatchObject([
      { sourceId: 's1', score: 1, matchedTerms: ['project', '负责人'] },
    ]);
  });

  it('uses OR recall and matchCount divided by unique term count', () => {
    const hits = runSubstringBaseline({
      sources: [
        { sourceId: 's1', title: 'A', body: '只有 alpha' },
        { sourceId: 's2', title: 'B', body: '同时包含 alpha beta' },
        { sourceId: 's3', title: 'C', body: '完全无关' },
      ],
      query: 'alpha beta gamma',
      topK: 10,
      segment: (value: string) => value,
    });

    expect(hits.map((hit: any) => [hit.sourceId, hit.score])).toEqual([
      ['s2', 2 / 3],
      ['s1', 1 / 3],
    ]);
  });

  it('scores individual chunks and preserves insertion order for ties', () => {
    const hits = runSubstringBaseline({
      sources: [{
        sourceId: 's1',
        title: 'A',
        chunks: [
          { chunkId: 'c1', text: 'alpha one' },
          { chunkId: 'c2', text: 'alpha two' },
        ],
      }],
      query: 'alpha',
      topK: 1,
      segment: (value: string) => value,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: 's1', chunkId: 'c1', score: 1 });
  });

  it('returns no hits for an empty segmented query', () => {
    expect(runSubstringBaseline({
      sources: [{ sourceId: 's1', title: 'A', body: 'alpha' }],
      query: '   ',
      segment: (value: string) => value,
    })).toEqual([]);
  });

  it('keeps the frozen qualification gate mathematically reachable', async () => {
    const fixtureRoot = join(process.cwd(), 'scripts/evals/graphiti-knowledge/fixtures');
    const sources = await loadCorpus(join(fixtureRoot, 'corpus.json'));
    const questions = await loadQuestions(join(fixtureRoot, 'questions.json'));
    const sourceEpisodeMap = Object.fromEntries(sources.map((source: any) => [source.sourceId, source.episodeUuid]));
    const scores = questions.map((question: any) => scoreQuestion(question, runSubstringBaseline({
      sources,
      query: question.query,
      topK: question.topK,
      segment: segmentQuery,
    }), { mode: 'baseline', sourceEpisodeMap }));
    const targeted = scores.filter((score: any) => score.category !== 'control');
    const control = scores.filter((score: any) => score.category === 'control');

    expect(targeted.filter((score: any) => score.correct).length / targeted.length).toBeLessThanOrEqual(0.85);
    expect(control.every((score: any) => score.correct)).toBe(true);
  });
});
