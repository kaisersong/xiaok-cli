import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

let tokenizeBaseline: any;
let runSubstringBaseline: any;

beforeAll(async () => {
  const module = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/graphiti-knowledge/baseline.mjs',
  )).href);
  tokenizeBaseline = module.tokenizeBaseline;
  runSubstringBaseline = module.runSubstringBaseline;
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
});
