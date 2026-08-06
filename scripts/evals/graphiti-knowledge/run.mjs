import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGuardedGraphitiClient } from './client.mjs';
import {
  createReplicaGroupId,
  loadCorpus,
  loadQuestions,
  resolveEvalConfig,
} from './contracts.mjs';
import { writeEvidenceBundle } from './evidence.mjs';
import { runGraphitiKnowledgeEval } from './runner.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(moduleDir, 'fixtures', 'corpus.json');
const questionsPath = join(moduleDir, 'fixtures', 'questions.json');

export async function runGraphitiPreflight({
  config,
  clientFactory = createGuardedGraphitiClient,
}) {
  const audit = [];
  const groupId = createReplicaGroupId(config.runId, 1);
  const client = await clientFactory({
    endpoint: config.endpoint,
    authHeader: config.authHeader,
    groupId,
    audit: (record) => audit.push(record),
  });
  try {
    return Object.freeze({
      recommendation: 'PREFLIGHT_OK',
      groupId,
      capabilities: client.capabilities,
      status: client.initialStatus,
      audit: Object.freeze(audit),
    });
  } finally {
    await client.close();
  }
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function readGitHead(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function installInterruptHandlers({ controller, processRef = process }) {
  const interrupt = () => controller.abort();
  processRef.on('SIGINT', interrupt);
  processRef.on('SIGTERM', interrupt);
  return () => {
    processRef.removeListener('SIGINT', interrupt);
    processRef.removeListener('SIGTERM', interrupt);
  };
}

async function main() {
  const config = resolveEvalConfig({
    env: process.env,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
  });
  if (config.preflightOnly) {
    const preflight = await runGraphitiPreflight({ config });
    console.log(JSON.stringify(preflight, null, 2));
    return;
  }

  const controller = new AbortController();
  const disposeInterruptHandlers = installInterruptHandlers({ controller });
  let report;
  let evidence;
  try {
    const [corpus, questions, segmentModule] = await Promise.all([
      loadCorpus(corpusPath),
      loadQuestions(questionsPath),
      import('../../../src/ai/memory/segment.js'),
    ]);
    report = await runGraphitiKnowledgeEval({
      runId: config.runId,
      replicaCount: config.replicas,
      endpoint: config.endpoint,
      authHeader: config.authHeader,
      corpus,
      questions,
      segment: segmentModule.segmentQuery,
      budgets: {
        maxWallMs: config.maxWallMs,
        maxCalls: config.maxCalls,
        maxIngestFailures: config.maxIngestFailures,
      },
      signal: controller.signal,
    });
    evidence = await writeEvidenceBundle({
      config,
      report,
      manifestBase: {
        gitHead: readGitHead(process.cwd()),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        corpusSha256: await sha256File(corpusPath),
        questionsSha256: await sha256File(questionsPath),
      },
    });
  } finally {
    disposeInterruptHandlers();
  }
  console.log(JSON.stringify({
    recommendation: report.qualification.recommendation,
    runId: report.runId,
    reportPath: evidence.reportPath,
  }, null, 2));
  process.exitCode = report.qualification.recommendation === 'GO'
    ? 0
    : report.qualification.recommendation === 'NO_GO'
      ? 2
      : 3;
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedUrl) {
  main().catch((error) => {
    const code = error instanceof Error
      ? error.message.split(':', 1)[0]
      : 'GRAPHITI_EVAL_UNKNOWN_FAILURE';
    console.error(JSON.stringify({ recommendation: 'INCOMPLETE', errorCode: code }));
    process.exitCode = 3;
  });
}
