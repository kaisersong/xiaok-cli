import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const evalRoot = join(process.cwd(), 'scripts', 'evals', 'graphiti-knowledge');
const corpusPath = join(evalRoot, 'fixtures', 'corpus.json');
const questionsPath = join(evalRoot, 'fixtures', 'questions.json');

async function loadContracts(): Promise<any> {
  return import(pathToFileURL(join(evalRoot, 'contracts.mjs')).href);
}

describe('Graphiti knowledge evaluation contracts', () => {
  it('loads a synthetic corpus with stable source and episode identities', async () => {
    const { loadCorpus } = await loadContracts();
    const corpus = await loadCorpus(corpusPath);

    expect(corpus.length).toBeGreaterThanOrEqual(10);
    expect(new Set(corpus.map((source: any) => source.sourceId)).size).toBe(corpus.length);
    expect(new Set(corpus.map((source: any) => source.episodeUuid)).size).toBe(corpus.length);
    expect(corpus.some((source: any) => source.isInjection === true)).toBe(true);
    expect(corpus.every((source: any) => source.synthetic === true)).toBe(true);
  });

  it('requires exactly 30 questions with six per category and unique ids', async () => {
    const { loadQuestions } = await loadContracts();
    const questions = await loadQuestions(questionsPath);

    expect(questions).toHaveLength(30);
    expect(new Set(questions.map((question: any) => question.id)).size).toBe(30);
    for (const category of ['alias', 'multi_hop', 'temporal', 'provenance', 'control']) {
      expect(questions.filter((question: any) => question.category === category)).toHaveLength(6);
    }
  });

  it('requires temporal questions to carry an explicit validAt timestamp', async () => {
    const { loadQuestions } = await loadContracts();
    const questions = await loadQuestions(questionsPath);
    const temporal = questions.filter((question: any) => question.category === 'temporal');

    expect(temporal.every((question: any) => /Z$/.test(question.validAt))).toBe(true);
  });

  it('creates three stable and distinct opaque replica group ids', async () => {
    const { createReplicaGroupId } = await loadContracts();
    const groups = [1, 2, 3].map((index) => createReplicaGroupId('20260806-fixed', index));

    expect(groups).toEqual([
      'xiaok-g0-20260806-fixed-r1',
      'xiaok-g0-20260806-fixed-r2',
      'xiaok-g0-20260806-fixed-r3',
    ]);
    expect(new Set(groups).size).toBe(3);
  });

  it('rejects replica ids outside the three-group qualification contract', async () => {
    const { createReplicaGroupId } = await loadContracts();

    expect(() => createReplicaGroupId('20260806-fixed', 0))
      .toThrow('GRAPHITI_EVAL_GROUP_ID_INVALID');
    expect(() => createReplicaGroupId('20260806-fixed', 4))
      .toThrow('GRAPHITI_EVAL_GROUP_ID_INVALID');
  });

  it('rejects an output path outside the configured run root', async () => {
    const { assertSafeOutputPath } = await loadContracts();

    expect(() => assertSafeOutputPath('/tmp/eval-root', '/tmp/outside/report.json'))
      .toThrow('GRAPHITI_EVAL_OUTPUT_OUTSIDE_RUN_ROOT');
    expect(assertSafeOutputPath('/tmp/eval-root', '/tmp/eval-root/run/report.json'))
      .toBe('/tmp/eval-root/run/report.json');
  });

  it('fails closed without an explicit Graphiti endpoint', async () => {
    const { resolveEvalConfig } = await loadContracts();

    expect(() => resolveEvalConfig({ env: {}, argv: [], cwd: '/work' }))
      .toThrow('XIAOK_GRAPHITI_MCP_URL_REQUIRED');
  });

  it('maps every expected source to the frozen corpus', async () => {
    const { loadCorpus, loadQuestions, validateFixturePair } = await loadContracts();
    const corpus = await loadCorpus(corpusPath);
    const questions = await loadQuestions(questionsPath);

    expect(validateFixturePair(corpus, questions)).toBe(true);
  });

  it('serializes configuration without endpoint paths or auth material', async () => {
    const { resolveEvalConfig, toSafeConfigSnapshot } = await loadContracts();
    const config = resolveEvalConfig({
      env: {
        XIAOK_GRAPHITI_MCP_URL: 'https://graph.example.test/private/mcp/?tenant=secret',
        XIAOK_GRAPHITI_MCP_AUTH_HEADER: 'Authorization: Bearer super-secret',
      },
      argv: ['--run-id', '20260806-fixed'],
      cwd: '/work',
    });

    expect(toSafeConfigSnapshot(config)).toEqual(expect.objectContaining({
      endpointOrigin: 'https://graph.example.test',
      authConfigured: true,
    }));
    expect(JSON.stringify(toSafeConfigSnapshot(config))).not.toMatch(/private|tenant|super-secret|Authorization/);
  });
});
