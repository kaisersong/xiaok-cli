import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { terminateOwnedProcess } from '../../scripts/evals/local-model-cache/capture.mjs';

const event = (delta, reason) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
const call = (id, name, input, index = 0) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(input) } });

test('built CLI: toggle sorts real main/SubAgent requests, preserves tools and executes read/grep in both', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'xiaok-tool-order-cli-'));
  const cwd = join(root, 'work'); const configDir = join(root, 'config');
  await mkdir(cwd); await mkdir(configDir);
  const file = join(cwd, 'fixture.txt'); await writeFile(file, 'TOOL_ORDER_READ_GREP_OK\n');
  let active; const failures = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(req.url, '/v1/chat/completions');
      const names = body.tools.map(tool => tool.function.name);
      const role = names.includes('subagent') ? 'main' : 'child';
      const turn = active[role]++;
      active.requests.push({ role, tools: body.tools });
      assert(turn < 3, 'unexpected extra model turn');
      for (const name of ['read', 'grep']) assert(names.includes(name), `${role} must advertise ${name}`);
      if (role === 'child') {
        for (const name of ['write', 'edit', 'bash', 'spawn_agent']) assert(!names.includes(name));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (turn === 0) {
        res.end(event({ tool_calls: [
          call(`${role}_read`, 'read', { file_path: file }),
          call(`${role}_grep`, 'grep', { path: cwd, pattern: 'TOOL_ORDER_READ_GREP_OK' }, 1),
        ] }, 'tool_calls') + 'data: [DONE]\n\n');
      } else if (turn === 1) {
        for (const tool of ['read', 'grep']) {
          const result = body.messages.find(m => m.role === 'tool' && m.tool_call_id === `${role}_${tool}`);
          assert(result && JSON.stringify(result.content).includes('TOOL_ORDER_READ_GREP_OK'), `${role} ${tool} must actually succeed`);
        }
        active.verified.add(role);
        res.end(role === 'main'
          // web_search is advertised only to put a name after the appended tool_search in the baseline; never invoked.
          ? event({ tool_calls: [call('delegate', 'subagent', { prompt: 'Read and grep fixture.txt, then report SUBAGENT_VERIFIED.', description: 'Read-only fixture review', tools: ['Read', 'Grep', 'web_search'] })] }, 'tool_calls') + 'data: [DONE]\n\n'
          : event({ content: 'SUBAGENT_VERIFIED' }, 'stop') + 'data: [DONE]\n\n');
      } else {
        assert.equal(role, 'main');
        assert(body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'delegate' && JSON.stringify(m.content).includes('SUBAGENT_VERIFIED')));
        res.end(event({ content: 'MAIN_AND_SUBAGENT_VERIFIED' }, 'stop') + 'data: [DONE]\n\n');
      }
    } catch (error) {
      failures.push(error); if (!res.headersSent) res.writeHead(500); res.end('fixture assertion failed');
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`; const model = 'gpt-tool-order-fixture';
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ schemaVersion: 1, defaultModel: 'custom', models: { custom: { baseUrl, apiKey: 'fixture', model } }, defaultMode: 'interactive', contextBudget: 32000, channels: {} }));
  const runs = [];
  for (const setting of ['0', JSON.stringify({ baseUrl, model, order: 'name' })]) {
    active = { main: 0, child: 0, verified: new Set(), requests: [] };
    const child = spawn(process.execPath, [resolve('dist/index.js'), 'chat', '-p', 'Read and grep fixture.txt, delegate the independent read-only check, then report.'], {
      cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', XIAOK_CONFIG_DIR: configDir, XIAOK_DISABLE_GLOBAL_PLUGINS: '1', XIAOK_TURN_TIMEOUT_MS: '20000', XIAOK_EXPERIMENTAL_TOOL_ORDER: setting, NO_COLOR: '1' },
    });
    let output = ''; let errors = ''; let timeout = false; let termination = Promise.resolve(true);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
    const timer = setTimeout(() => { timeout = true; termination = terminateOwnedProcess(child); }, 25000);
    try {
      const [code] = await once(child, 'close'); await termination;
      assert.equal(timeout, false, errors); assert.equal(code, 0, errors);
      if (failures.length) throw failures[0];
      assert(output.includes('MAIN_AND_SUBAGENT_VERIFIED'), output + errors);
      assert.deepEqual([...active.verified].sort(), ['child', 'main']);
      assert.equal(active.requests.length, 5);
      runs.push(active.requests);
    } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) await terminateOwnedProcess(child); }
  }
  for (let i = 0; i < runs[0].length; i++) {
    const off = runs[0][i]; const on = runs[1][i];
    assert.equal(off.role, on.role);
    const offNames = off.tools.map(tool => tool.function.name); const onNames = on.tools.map(tool => tool.function.name);
    assert.deepEqual(onNames, [...offNames].sort());
    assert.notDeepEqual(offNames, onNames, `${off.role}: experiment must change real wire order`);
    const byName = tools => Object.fromEntries(tools.map(tool => [tool.function.name, tool]));
    assert.deepEqual(byName(off.tools), byName(on.tools), 'definitions and permissions must be identical');
  }
});
