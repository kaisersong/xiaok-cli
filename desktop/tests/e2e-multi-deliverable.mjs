#!/usr/bin/env node
/**
 * E2E test: multi-deliverable task must produce 2 artifacts.
 *
 * Prerequisites:
 * - Desktop app running with --remote-debugging-port=9222
 * - Valid OpenAI API key configured in the app
 *
 * Usage: node desktop/tests/e2e-multi-deliverable.mjs
 */

import WebSocket from 'ws';

const CDP_URL = 'http://127.0.0.1:9222/json';
const PROMPT = '根据claude本月的更新生成报告和演示文档';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max
const POLL_INTERVAL_MS = 5000;

async function getWsUrl() {
  const resp = await fetch(CDP_URL);
  const pages = await resp.json();
  const page = pages.find(p => p.type === 'page' && p.url.includes('renderer'));
  if (!page) throw new Error('No renderer page found');
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

async function main() {
  console.log('[e2e] Connecting to CDP...');
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('[e2e] Connected.');

  // Enable Runtime domain
  await cdpCall(ws, 'Runtime.enable');

  // Create the task
  console.log(`[e2e] Creating task: "${PROMPT}"`);
  const createResult = await evalInPage(ws, `
    window.xiaokDesktop.createTask({ prompt: ${JSON.stringify(PROMPT)}, materials: [] })
      .then(r => JSON.stringify(r))
  `);
  const { taskId } = JSON.parse(createResult);
  console.log(`[e2e] Task created: ${taskId}`);

  // Poll until task completes or fails
  const startTime = Date.now();
  let finalSnapshot = null;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const snapshotJson = await evalInPage(ws, `
      window.xiaokDesktop.recoverTask('${taskId}')
        .then(r => JSON.stringify({ status: r.snapshot.status, events: r.snapshot.events }))
    `);
    const { status, events } = JSON.parse(snapshotJson);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const artifacts = events.filter(e => e.type === 'artifact_recorded');
    console.log(`[e2e] [${elapsed}s] status=${status}, artifacts=${artifacts.length}`);

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      finalSnapshot = { status, events };
      break;
    }
  }

  ws.close();

  if (!finalSnapshot) {
    console.error('[e2e] TIMEOUT: task did not complete within', TIMEOUT_MS / 1000, 'seconds');
    process.exit(1);
  }

  if (finalSnapshot.status !== 'completed') {
    console.error(`[e2e] FAIL: task ended with status "${finalSnapshot.status}"`);
    process.exit(1);
  }

  const artifacts = finalSnapshot.events.filter(e => e.type === 'artifact_recorded');
  console.log('[e2e] Artifacts produced:');
  for (const a of artifacts) {
    console.log(`  - [${a.kind}] ${a.label} → ${a.filePath || '(no path)'}`);
  }

  if (artifacts.length < 2) {
    console.error(`[e2e] FAIL: expected at least 2 artifacts, got ${artifacts.length}`);
    process.exit(1);
  }

  console.log(`[e2e] PASS: ${artifacts.length} artifacts produced.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[e2e] Fatal error:', err.message);
  process.exit(1);
});
