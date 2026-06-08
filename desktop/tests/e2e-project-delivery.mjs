#!/usr/bin/env node
/**
 * E2E test: a brand-new KSwarm project, created through the SAME path the
 * desktop UI uses, must run end-to-end and reach a real delivered state.
 *
 * Why this exists (复盘 P2-11 / 8.5):
 * - The existing `e2e-multi-deliverable.mjs` exercises the single-task desktop
 *   flow, NOT a KSwarm *project*.
 * - The strict pass standard for a KSwarm project is BOTH of:
 *     1. project `status === 'delivered'`
 *     2. the `delivery/` directory contains real artifact files
 *   (either alone is insufficient).
 * - This script faithfully reproduces the UI create path: it drives the
 *   renderer process over CDP so the request goes through the real
 *   `httpPost('/projects', { autoStartPlanning: false })` + IPC
 *   `kswarmStartProjectPlanning` planning bootstrap — exactly what P0-1/P0-2/
 *   P0-3 fixed — rather than poking the server API directly.
 *
 * Prerequisites:
 * - Packaged app installed to /Applications/xiaok.app (NOT dev electron),
 *   launched with --remote-debugging-port=9222.
 * - KSwarm service reachable on http://127.0.0.1:4400 with at least one
 *   runtime-backed agent that can act as PO.
 * - A valid model/API key configured in the app.
 *
 * Usage: node desktop/tests/e2e-project-delivery.mjs
 *
 * NOTE: This is a long-running manual/E2E check. It is intentionally NOT wired
 * into the default vitest/CI run.
 */

import WebSocket from 'ws';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222/json';
const KSWARM_BASE = process.env.KSWARM_BASE || 'http://127.0.0.1:4400';

// A small, self-contained goal that should yield at least one real artifact.
const PROJECT_NAME = `E2E-项目交付复验-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
const GOAL = '用一页 Markdown 总结 2026 年 AI 编程助手的三个关键趋势，并给出简短结论。';
const REQUIREMENTS = '输出单个 Markdown 文件即可，包含标题、三个趋势小节和一段结论。';

const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes: planning + dispatch + execution + review + deliver
const POLL_INTERVAL_MS = 5000;

// Terminal-but-not-delivered states we should fail fast on.
const FATAL_STATUSES = new Set(['closed']);

// ─── CDP plumbing ─────────────────────────────────────────────────

async function getRendererWsUrl() {
  const resp = await fetch(CDP_URL);
  const pages = await resp.json();
  const page = pages.find((p) => p.type === 'page' && p.url.includes('renderer'));
  if (!page) throw new Error('No renderer page found (is /Applications/xiaok.app running with --remote-debugging-port=9222?)');
  return page.webSocketDebuggerUrl;
}

function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInPage(ws, expression) {
  const result = await cdpCall(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS Error: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value;
}

// ─── KSwarm REST helpers (read-only verification + PO discovery) ───

async function kswarmJson(path, init) {
  const res = await fetch(`${KSWARM_BASE}${path}`, init);
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* non-json body */ }
    throw new Error(`KSwarm ${init?.method || 'GET'} ${path} -> ${res.status} ${detail}`);
  }
  return res.json();
}

async function pickPoAgent() {
  const data = await kswarmJson('/agents');
  const agents = Array.isArray(data) ? data : data.agents || data.items || [];
  // Prefer an explicit project_owner that KSwarm can actually dispatch to.
  // runtimeHealth can remain "healthy" for CLI agents whose current status is
  // offline, and dispatch will reject those with waiting_for_capable_agent.
  const isHealthy = (a) => {
    const state = a.runtimeHealth?.state || a.health?.state;
    return state ? state === 'healthy' : true;
  };
  const isIdle = (a) => String(a.status || '').toLowerCase() === 'idle';
  const isUsable = (a) => isHealthy(a) && isIdle(a);
  const score = (a) => {
    let value = 0;
    if (Array.isArray(a.roles) && a.roles.includes('project_owner')) value += 100;
    if (a.runtimeType === 'xiaok') value += 20;
    if (a.brokerOnline) value += 10;
    if (a.id === 'xiaok' || a.id === 'xiaok-po') value += 5;
    return value;
  };
  const candidates = agents
    .filter((a) => Array.isArray(a.roles) && a.roles.includes('project_owner') && isUsable(a))
    .sort((a, b) => score(b) - score(a));
  if (candidates[0]) return candidates[0].id;

  const roleless = agents.find((a) => (!a.roles || a.roles.length === 0) && isUsable(a));
  if (roleless) return roleless.id;
  throw new Error('No usable agent found to act as PO');
}

// ─── UI-path project creation (via renderer over CDP) ──────────────

async function createProjectViaUiPath(ws, { name, goal, requirements, poAgent }) {
  // Reproduce useKSwarmClient.createProject:
  //   1. POST /projects with autoStartPlanning:false (server returns {ok, project, ...})
  //   2. unwrap response.project, require project.id
  //   3. enqueue planning bootstrap through the IPC bridge
  //      window.xiaokDesktop.kswarmStartProjectPlanning(...)
  const expr = `
    (async () => {
      const base = ${JSON.stringify(KSWARM_BASE)};
      const createRes = await fetch(base + '/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ${JSON.stringify(name)},
          goal: ${JSON.stringify(goal)},
          requirements: ${JSON.stringify(requirements)},
          poAgent: ${JSON.stringify(poAgent)},
          members: [${JSON.stringify(poAgent)}],
          enableSummary: true,
          autoStartPlanning: false,
        }),
      });
      const envelope = await createRes.json().catch(() => null);
      const project = envelope && envelope.project ? envelope.project : null;
      if (!project || !project.id) {
        return JSON.stringify({ ok: false, stage: 'create', envelope });
      }
      const api = window.xiaokDesktop;
      if (!api || !api.kswarmStartProjectPlanning) {
        return JSON.stringify({ ok: false, stage: 'ipc_missing', projectId: project.id });
      }
      const enqueue = await api.kswarmStartProjectPlanning({
        projectId: project.id,
        projectName: project.name,
        goal: ${JSON.stringify(goal)},
        requirements: ${JSON.stringify(requirements)},
        planningGuidance: '',
        poAgent: ${JSON.stringify(poAgent)},
        members: [${JSON.stringify(poAgent)}],
      });
      return JSON.stringify({ ok: !!(enqueue && enqueue.ok), stage: 'enqueue', projectId: project.id, enqueue });
    })()
  `;
  const raw = await evalInPage(ws, expr);
  return JSON.parse(raw);
}

// ─── Delivery verification (the strict, two-part pass standard) ────

async function verifyDelivery(projectId) {
  // Part 1: project status must be 'delivered'.
  const detail = await kswarmJson(`/projects/${encodeURIComponent(projectId)}`);
  const project = detail.project || detail;
  if (project.status !== 'delivered') {
    return { ok: false, reason: `status is "${project.status}", expected "delivered"` };
  }
  // Part 2: delivery/ must contain a readable manifest with real artifacts.
  const delivery = await kswarmJson(`/projects/${encodeURIComponent(projectId)}/delivery`);
  const artifacts = delivery?.manifest?.artifacts || [];
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return { ok: false, reason: 'delivery manifest has no artifacts' };
  }
  // Spot-check that at least one artifact file is actually served (non-empty).
  let servedCount = 0;
  for (const a of artifacts) {
    const fname = a.filename || a.name;
    if (!fname) continue;
    const res = await fetch(`${KSWARM_BASE}/projects/${encodeURIComponent(projectId)}/delivery/${encodeURIComponent(fname)}`);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 0) servedCount++;
    }
  }
  if (servedCount === 0) {
    return { ok: false, reason: 'no delivery artifact file could be fetched with non-empty content' };
  }
  return { ok: true, status: project.status, artifactCount: artifacts.length, servedCount };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('[e2e-project] Selecting a PO agent...');
  const poAgent = await pickPoAgent();
  console.log(`[e2e-project] PO agent: ${poAgent}`);

  console.log('[e2e-project] Connecting to renderer over CDP...');
  const wsUrl = await getRendererWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  await cdpCall(ws, 'Runtime.enable');
  console.log('[e2e-project] Connected.');

  console.log(`[e2e-project] Creating project via UI path: "${PROJECT_NAME}"`);
  const created = await createProjectViaUiPath(ws, {
    name: PROJECT_NAME,
    goal: GOAL,
    requirements: REQUIREMENTS,
    poAgent,
  });
  ws.close();

  if (!created.ok) {
    console.error('[e2e-project] FAIL: project create/planning enqueue failed:', JSON.stringify(created));
    process.exit(1);
  }
  const projectId = created.projectId;
  console.log(`[e2e-project] Project created and planning enqueued: ${projectId}`);

  // Poll the project until it reaches 'delivered' or a fatal/terminal state.
  const startTime = Date.now();
  let lastStatus = null;
  let delivered = false;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let detail;
    let project;
    try {
      detail = await kswarmJson(`/projects/${encodeURIComponent(projectId)}`);
      project = detail.project || detail;
    } catch (err) {
      console.warn(`[e2e-project] poll error (will retry): ${err.message}`);
      continue;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const tasks = detail.tasks || project.tasks || [];
    const doneCount = tasks.filter((t) => t.status === 'done').length;
    const projectHealth = detail.projectHealth || project.projectHealth || null;
    const dispatchPlan = detail.dispatchPlan || project.dispatchPlan || null;
    const interventionInfo = detail.projectIntervention || project.projectIntervention || null;
    const intervention = interventionInfo?.type || interventionInfo?.kind || interventionInfo?.reason || null;
    if (project.status !== lastStatus) {
      console.log(`[e2e-project] [${elapsed}s] status=${project.status} tasks=${doneCount}/${tasks.length}${intervention ? ` intervention=${intervention}` : ''}`);
      lastStatus = project.status;
    } else {
      console.log(`[e2e-project] [${elapsed}s] ... status=${project.status} tasks=${doneCount}/${tasks.length}${intervention ? ` intervention=${intervention}` : ''}`);
    }

    if (projectHealth?.gate === 'waiting_for_capable_agent' || projectHealth?.gate === 'waiting_for_busy_agents') {
      const skipped = (dispatchPlan?.skipped || []).map((s) => `${s.taskId || 'unknown'}:${s.reason || 'unknown'}:${s.agent || 'unknown'}`).join(', ');
      console.error(`[e2e-project] FAIL: project is blocked by dispatch gate "${projectHealth.gate}" (${skipped || 'no dispatch details'})`);
      process.exit(1);
    }

    if (project.status === 'delivered') {
      delivered = true;
      break;
    }

    // ready_to_deliver is intentionally a manual gate (B3): all tasks done but
    // delivery awaits a PO action. Drive the deliver step the same way the UI
    // "交付" button does, so the E2E can verify the full delivered + delivery/
    // outcome rather than stalling here forever.
    if (intervention === 'ready_to_deliver') {
      console.log('[e2e-project] ready_to_deliver intervention detected -> issuing PO deliver');
      try {
        const deliverRes = await kswarmJson(`/projects/${encodeURIComponent(projectId)}/deliver`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromAgent: project.poAgent || poAgent }),
        });
        console.log(`[e2e-project] deliver result: ${JSON.stringify(deliverRes)}`);
      } catch (err) {
        console.error(`[e2e-project] FAIL: deliver request errored: ${err.message}`);
        process.exit(1);
      }
    }

    if (FATAL_STATUSES.has(project.status)) {
      console.error(`[e2e-project] FAIL: project reached terminal non-delivered status "${project.status}"`);
      process.exit(1);
    }
  }

  if (!delivered) {
    console.error(`[e2e-project] TIMEOUT: project did not reach "delivered" within ${TIMEOUT_MS / 1000}s (last status=${lastStatus})`);
    process.exit(1);
  }

  console.log('[e2e-project] Verifying strict delivery standard (status=delivered AND delivery/ has real files)...');
  const verdict = await verifyDelivery(projectId);
  if (!verdict.ok) {
    console.error(`[e2e-project] FAIL: ${verdict.reason}`);
    process.exit(1);
  }

  console.log(`[e2e-project] PASS: project ${projectId} delivered with ${verdict.artifactCount} manifest artifacts (${verdict.servedCount} files served non-empty).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e-project] Fatal error:', err.message);
  process.exit(1);
});
