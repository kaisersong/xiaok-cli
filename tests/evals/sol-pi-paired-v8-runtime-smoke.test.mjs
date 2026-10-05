import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createPairedMechanism } from '../../scripts/evals/sol-pi/paired-mechanism.mjs';
import { AgentSessionState } from '../../src/ai/runtime/session.ts';
import { AgentRuntime } from '../../src/ai/runtime/agent-runtime.ts';
import { AgentRunController } from '../../src/ai/runtime/controller.ts';
import { ToolRegistry } from '../../src/ai/tools/index.ts';
import { bashTool } from '../../src/ai/tools/bash.ts';
import { createReadTool } from '../../src/ai/tools/read.ts';
import { OpenAIAdapter } from '../../src/ai/adapters/openai.ts';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../src/ai/providers/model-harness-profile.ts';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function response(file, bash = false) {
 const delta = file ? { tool_calls: [{ index: 0, id: 'native-read', type: 'function', function: { name: bash ? 'bash' : 'read', arguments: JSON.stringify(bash ? { command: 'node verify.cjs', workdir: '.', max_chars: 80 } : { file_path: file, max_chars: 80 }) } }] } : { content: 'done' };
 return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: file ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
for (const bash of [false, true]) test(`v8 real paired mechanism and Runtime ${bash ? 'bash relative workdir' : 'read'} prepare two full views then reference using official offline capacity`, { timeout: 120000 }, async () => {
 const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'solpi-v8-runtime-')));
 const originalFetch = globalThis.fetch, originalCwd = process.cwd(), sourceRoot = resolve('.'); let mechanism, registry; let visibleVerified = false;
 try {
  const workspace = join(root, 'workspace'); await fs.mkdir(workspace);
  const content = 'head '.repeat(1500) + 'UNIQUE_ARCHIVED_MIDDLE' + 'tail '.repeat(1500), file = join(workspace, 'fixture.txt');
  await fs.writeFile(file, content);
  if (bash) await fs.writeFile(join(workspace, 'verify.cjs'), "console.log('VISIBLE_VECTORS_PASSED:3');console.log(" + JSON.stringify(content) + ');');
  process.chdir(workspace);
  const environmentPath = join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json');
  const manifestPath = join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/manifest.json');
  const environmentBytes = await fs.readFile(environmentPath), manifestBytes = await fs.readFile(manifestPath);
  const recipeEnvironment = { environmentPath: await fs.realpath(environmentPath), manifestPath: await fs.realpath(manifestPath), environmentSha256: sha(environmentBytes), manifestFileSha256: sha(manifestBytes), manifestSemanticSha256: JSON.parse(manifestBytes).sha256 };
  const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'v8-offline-smoke', cwd: workspace });
  mechanism = await createPairedMechanism({ sourceRoot, runDirectory: root, workspace, task: { files: { 'fixture.txt': content } }, session, command: bash ? 'node verify.cjs' : null, recipeEnvironment,
   protocol: 'openai_legacy', profileId: 'generic-openai', destination: { provider: 'deepseek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions' } });
  registry = new ToolRegistry({ autoMode: true, onToolObserved: event => { if (event.toolName === 'bash' && event.ok && event.result.includes('VISIBLE_VECTORS_PASSED:3')) visibleVerified = true; } }, [bash ? bashTool : createReadTool({ cwd: workspace }), mechanism.recallTool]);
  const bodies = [];
  // Every SDK request is intercepted. No code delegates to the original fetch.
  globalThis.fetch = async (_url, init) => { bodies.push(String(init.body)); return response(bodies.length === 1 ? file : undefined, bash); };
  const adapter = new OpenAIAdapter({ apiKey: 'offline-fixture', kimiCodingHeadersApplied: false,
   harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'deepseek', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://api.deepseek.com', wireModel: 'deepseek-flash', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}) }) });
  const runtime = new AgentRuntime({ adapter, registry, session, controller: new AgentRunController(), systemPrompt: 'Read the fixture.', observationOwner: mechanism.owner, maxIterations: 4 });
  await runtime.run('read', () => {}); await runtime.run('continue', () => {}); await runtime.run('continue', () => {});
  assert.equal(bodies.length, 4);
  if (bash) assert.equal(visibleVerified, true, 'original code visible verifier must survive observation projection');
  assert.match(bodies[1], /UNIQUE_ARCHIVED_MIDDLE/); assert.match(bodies[2], /UNIQUE_ARCHIVED_MIDDLE/); assert.doesNotMatch(bodies[3], /UNIQUE_ARCHIVED_MIDDLE/);
  assert.doesNotMatch(JSON.stringify(session.getMessages()), /UNIQUE_ARCHIVED_MIDDLE/);
  const facts = mechanism.diagnostics(); assert.equal(facts.qualified, true); assert.equal(facts.captures, 1);
  assert.equal(facts.projection.projectedRequests, 3); assert.equal(facts.projection.reasons.recall_unavailable ?? 0, 0);
  assert.equal(facts.projection.fullObservationViews, 2); assert.equal(facts.projection.referenceObservationViews, 1);
  assert.deepEqual(facts.counters.map(row => row.fullLogicalSendCount), [2]);
 } finally { globalThis.fetch = originalFetch; process.chdir(originalCwd); registry?.dispose(); mechanism?.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});
