import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const QUESTION_CATEGORIES = Object.freeze([
  'alias',
  'multi_hop',
  'temporal',
  'provenance',
  'control',
]);

const SOURCE_KEYS = Object.freeze([
  'sourceId',
  'episodeUuid',
  'title',
  'body',
  'referenceTime',
  'expectedFacts',
  'isInjection',
  'synthetic',
]);
const QUESTION_KEYS = Object.freeze([
  'id',
  'category',
  'query',
  'expectedAnyTerms',
  'expectedSourceIds',
  'topK',
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RFC3339_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const SOURCE_ID = /^syn-[a-z0-9-]{3,80}$/u;
const RUN_ID = /^[a-z0-9-]{8,64}$/u;
const QUESTION_ID = /^(?:alias|multi|temporal|provenance|control)-\d{2}$/u;
const SUSPECT_PRIVATE_TEXT = /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|sk-[A-Za-z0-9_-]{20,}|(?:api[_ -]?key|authorization)\s*[:=]\s*\S+)/iu;

function isPlainObject(value) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) throw new Error('GRAPHITI_EVAL_FIXTURE_OBJECT_REQUIRED');
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !allowed.has(key))) {
    throw new Error('GRAPHITI_EVAL_FIXTURE_KEYS_INVALID');
  }
}

function assertNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
}

function assertStringArray(value, code) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(code);
  }
}

function validateSource(source) {
  assertExactKeys(source, SOURCE_KEYS);
  if (!SOURCE_ID.test(source.sourceId)) throw new Error('GRAPHITI_EVAL_SOURCE_ID_INVALID');
  if (!UUID_V4.test(source.episodeUuid)) throw new Error('GRAPHITI_EVAL_EPISODE_UUID_INVALID');
  assertNonEmptyString(source.title, 'GRAPHITI_EVAL_SOURCE_TITLE_INVALID');
  assertNonEmptyString(source.body, 'GRAPHITI_EVAL_SOURCE_BODY_INVALID');
  if (!RFC3339_WITH_ZONE.test(source.referenceTime)) throw new Error('GRAPHITI_EVAL_REFERENCE_TIME_INVALID');
  assertStringArray(source.expectedFacts, 'GRAPHITI_EVAL_EXPECTED_FACTS_INVALID');
  if (typeof source.isInjection !== 'boolean' || source.synthetic !== true) {
    throw new Error('GRAPHITI_EVAL_SYNTHETIC_SOURCE_REQUIRED');
  }
  const serialized = JSON.stringify(source);
  if (SUSPECT_PRIVATE_TEXT.test(serialized)) throw new Error('GRAPHITI_EVAL_PRIVATE_FIXTURE_REJECTED');
  return Object.freeze({
    ...source,
    expectedFacts: Object.freeze([...source.expectedFacts]),
  });
}

function validateQuestion(question) {
  const required = question?.category === 'temporal'
    ? [...QUESTION_KEYS, 'validAt']
    : QUESTION_KEYS;
  assertExactKeys(question, required);
  if (!QUESTION_ID.test(question.id)) throw new Error('GRAPHITI_EVAL_QUESTION_ID_INVALID');
  if (!QUESTION_CATEGORIES.includes(question.category)) throw new Error('GRAPHITI_EVAL_QUESTION_CATEGORY_INVALID');
  assertNonEmptyString(question.query, 'GRAPHITI_EVAL_QUERY_INVALID');
  assertStringArray(question.expectedAnyTerms, 'GRAPHITI_EVAL_EXPECTED_TERMS_INVALID');
  assertStringArray(question.expectedSourceIds, 'GRAPHITI_EVAL_EXPECTED_SOURCES_INVALID');
  if (!Number.isInteger(question.topK) || question.topK < 1 || question.topK > 50) {
    throw new Error('GRAPHITI_EVAL_TOP_K_INVALID');
  }
  if (question.category === 'temporal' && !RFC3339_WITH_ZONE.test(question.validAt)) {
    throw new Error('GRAPHITI_EVAL_VALID_AT_INVALID');
  }
  return Object.freeze({
    ...question,
    expectedAnyTerms: Object.freeze([...question.expectedAnyTerms]),
    expectedSourceIds: Object.freeze([...question.expectedSourceIds]),
  });
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(code, { cause: error });
  }
}

export async function loadCorpus(path) {
  const document = await readJson(path, 'GRAPHITI_EVAL_CORPUS_READ_FAILED');
  assertExactKeys(document, ['schemaVersion', 'sources']);
  if (document.schemaVersion !== 1 || !Array.isArray(document.sources) || document.sources.length < 10) {
    throw new Error('GRAPHITI_EVAL_CORPUS_SCHEMA_INVALID');
  }
  const sources = document.sources.map(validateSource);
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw new Error('GRAPHITI_EVAL_SOURCE_ID_DUPLICATE');
  }
  if (new Set(sources.map((source) => source.episodeUuid)).size !== sources.length) {
    throw new Error('GRAPHITI_EVAL_EPISODE_UUID_DUPLICATE');
  }
  if (!sources.some((source) => source.isInjection)) {
    throw new Error('GRAPHITI_EVAL_INJECTION_SOURCE_REQUIRED');
  }
  return Object.freeze(sources);
}

export async function loadQuestions(path) {
  const document = await readJson(path, 'GRAPHITI_EVAL_QUESTIONS_READ_FAILED');
  assertExactKeys(document, ['schemaVersion', 'questions']);
  if (document.schemaVersion !== 1 || !Array.isArray(document.questions) || document.questions.length !== 30) {
    throw new Error('GRAPHITI_EVAL_QUESTIONS_SCHEMA_INVALID');
  }
  const questions = document.questions.map(validateQuestion);
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error('GRAPHITI_EVAL_QUESTION_ID_DUPLICATE');
  }
  for (const category of QUESTION_CATEGORIES) {
    if (questions.filter((question) => question.category === category).length !== 6) {
      throw new Error(`GRAPHITI_EVAL_CATEGORY_COUNT_INVALID:${category}`);
    }
  }
  return Object.freeze(questions);
}

export function validateFixturePair(corpus, questions) {
  const sourceIds = new Set(corpus.map((source) => source.sourceId));
  for (const question of questions) {
    for (const sourceId of question.expectedSourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`GRAPHITI_EVAL_UNKNOWN_EXPECTED_SOURCE:${sourceId}`);
    }
  }
  return true;
}

export function createReplicaGroupId(runId, index) {
  if (!RUN_ID.test(runId) || !Number.isInteger(index) || index < 1 || index > 3) {
    throw new Error('GRAPHITI_EVAL_GROUP_ID_INVALID');
  }
  return `xiaok-g0-${runId}-r${index}`;
}

export function assertSafeOutputPath(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) {
    throw new Error('GRAPHITI_EVAL_OUTPUT_OUTSIDE_RUN_ROOT');
  }
  return resolvedCandidate;
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readPositiveInteger(raw, fallback, code, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(code);
  return value;
}

function defaultRunId(now, uuid) {
  const timestamp = new Date(now()).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'z').toLowerCase();
  return `${timestamp}-${uuid().slice(0, 8).toLowerCase()}`;
}

export function resolveEvalConfig({
  env = process.env,
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  now = Date.now,
  uuid = randomUUID,
} = {}) {
  const endpointRaw = env.XIAOK_GRAPHITI_MCP_URL?.trim();
  if (!endpointRaw) throw new Error('XIAOK_GRAPHITI_MCP_URL_REQUIRED');
  let endpoint;
  try {
    endpoint = new URL(endpointRaw);
  } catch (error) {
    throw new Error('XIAOK_GRAPHITI_MCP_URL_INVALID', { cause: error });
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('XIAOK_GRAPHITI_MCP_URL_INVALID');
  }

  const runId = readArg(argv, '--run-id') ?? defaultRunId(now, uuid);
  if (!RUN_ID.test(runId)) throw new Error('GRAPHITI_EVAL_RUN_ID_INVALID');
  const runRoot = resolve(env.XIAOK_GRAPHITI_EVAL_RUN_ROOT?.trim() || join(cwd, '.xiaok', 'evals', 'graphiti-knowledge'));
  const requestedOutput = readArg(argv, '--output-dir') ?? join(runRoot, runId);
  const outputDir = assertSafeOutputPath(runRoot, requestedOutput);
  const preflightOnly = argv.includes('--preflight-only');
  const replicas = readPositiveInteger(readArg(argv, '--replicas'), preflightOnly ? 1 : 1, 'GRAPHITI_EVAL_REPLICAS_INVALID', { max: 3 });

  return Object.freeze({
    endpoint: endpoint.toString(),
    endpointOrigin: endpoint.origin,
    authHeader: env.XIAOK_GRAPHITI_MCP_AUTH_HEADER?.trim() || undefined,
    authConfigured: Boolean(env.XIAOK_GRAPHITI_MCP_AUTH_HEADER?.trim()),
    runId,
    runRoot,
    outputDir,
    preflightOnly,
    replicas,
    maxWallMs: readPositiveInteger(readArg(argv, '--max-wall-ms'), 600_000, 'GRAPHITI_EVAL_MAX_WALL_INVALID'),
    maxCalls: readPositiveInteger(readArg(argv, '--max-calls'), 400, 'GRAPHITI_EVAL_MAX_CALLS_INVALID'),
    maxIngestFailures: readPositiveInteger(readArg(argv, '--max-ingest-failures'), 0, 'GRAPHITI_EVAL_MAX_INGEST_FAILURES_INVALID', { min: 0 }),
  });
}

export function toSafeConfigSnapshot(config) {
  return Object.freeze({
    endpointOrigin: config.endpointOrigin,
    authConfigured: config.authConfigured,
    runId: config.runId,
    preflightOnly: config.preflightOnly,
    replicas: config.replicas,
    maxWallMs: config.maxWallMs,
    maxCalls: config.maxCalls,
    maxIngestFailures: config.maxIngestFailures,
  });
}
