import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { materializeFreshProductSession, createProductLaunch } from '../_desktop-runtime/launch.mjs';
import { connectToRenderer } from '../_desktop-runtime/connect.mjs';
import { runProductRendererTurn } from '../_desktop-runtime/renderer-turn.mjs';
import { extractSessionSignals } from '../_desktop-runtime/snapshot-extract.mjs';
import { scoreReport } from './scorers/report-scorer.mjs';
import { scoreSlide } from './scorers/slide-scorer.mjs';
import { scoreProject } from './scorers/project-scorer.mjs';
import { scoreSafety } from './scorers/safety-scorer.mjs';
import { captureFailure } from './failure-capture.mjs';

const CATEGORY_SCORERS = {
  report: scoreReport,
  slide: scoreSlide,
  project: scoreProject,
};

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PRODUCT_EVAL_TURN_TIMEOUT')) return 'timeout';
  return 'infra-error';
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Runs ONE product session end to end against the packaged app:
 * isolated session dirs → launch → CDP → drive turns → extract full-snapshot
 * signals → category scorer + mandatory safety scorer → failure capture.
 */
export async function runProductSession({ entry, config }) {
  const { task } = entry;
  const session = await materializeFreshProductSession({
    runRoot: config.runRoot,
    sessionId: entry.sessionKey.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60),
    debuggingPort: config.debuggingPort,
  });
  const launch = createProductLaunch({ appPath: config.appPath, session });

  let child = null;
  let browser = null;
  let page = null;
  let lastTurn = null;
  const base = {
    sessionKey: entry.sessionKey,
    taskId: entry.taskId,
    category: entry.category,
    replicaIndex: entry.replicaIndex,
  };

  try {
    child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    ({ browser, page } = await connectToRenderer({
      desktopRoot: config.desktopRoot,
      debuggingPort: session.debuggingPort,
      timeoutMs: 60000,
    }));

    const turns = [...task.turns].sort((a, b) => a.ordinal - b.ordinal);
    for (const turn of turns) {
      lastTurn = await runProductRendererTurn({
        page,
        prompt: turn.prompt,
        timeoutMs: task.timeoutMs,
      });
    }

    const signals = extractSessionSignals(lastTurn.snapshot);
    const safety = scoreSafety({ task, signals });
    const scorer = CATEGORY_SCORERS[task.category];
    const outcome = scorer({ task, signals });
    const passed = outcome.passed && safety.passed;

    const record = {
      ...base,
      status: passed ? 'passed' : 'failed',
      passed,
      reasons: [
        ...(outcome.reasons ?? []),
        ...safety.violations.map(name => `forbidden-tool-invoked: ${name}`),
      ],
      artifactPath: outcome.artifactPath ?? null,
      projectId: outcome.projectId ?? null,
      totalLatencyMs: lastTurn.totalLatencyMs,
      timeToFirstUserVisibleAssistantContentMs:
        lastTurn.timeToFirstUserVisibleAssistantContentMs,
    };
    if (!passed) {
      record.failureDir = await captureFailure({
        runRoot: config.runRoot,
        sessionKey: entry.sessionKey,
        snapshot: lastTurn.snapshot,
        signals,
        page,
      });
    }
    return record;
  } catch (error) {
    const status = classifyError(error);
    const record = {
      ...base,
      status,
      passed: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    record.failureDir = await captureFailure({
      runRoot: config.runRoot,
      sessionKey: entry.sessionKey,
      snapshot: lastTurn?.snapshot ?? null,
      signals: null,
      page,
    }).catch(() => undefined);
    return record;
  } finally {
    await browser?.close().catch(() => {});
    await stopProcess(child);
    await rm(session.sessionRoot, { recursive: true, force: true, maxRetries: 3 })
      .catch(() => {});
  }
}
