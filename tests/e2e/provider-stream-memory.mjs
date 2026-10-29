// Real SDK/HTTP regression. Run in a separate --expose-gc process with a fixed heap.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const moduleRoot = path.resolve(process.argv[2] ?? 'dist');
const load = relative => import(pathToFileURL(path.join(moduleRoot, relative)).href);
const { OpenAIAdapter } = await load('ai/adapters/openai.js');
const { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } = await load('ai/providers/model-harness-profile.js');
assert.equal(typeof global.gc, 'function', '--expose-gc is required');
const holdOpen = process.argv.includes('--hold-open');
const responses = new Set();
let requests = 0, closed = 0, peakOpen = 0;
const server = http.createServer(async (request, response) => {
  for await (const _ of request) { /* Read the actual serialized SDK body. */ }
  requests++; responses.add(response); peakOpen = Math.max(peakOpen, responses.size);
  response.on('close', () => { responses.delete(response); closed++; });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'example',
    choices: [{ index: 0, delta: { content: 'complete' }, finish_reason: 'stop' }] })}\n\n`);
  if (!holdOpen) response.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const task = new AbortController();
try {
  const adapter = new OpenAIAdapter({ apiKey: 'fixture', harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy',
      canonicalBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, wireModel: 'example', capabilities: ['tools'] },
    flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  global.gc(); const start = process.memoryUsage().heapUsed;
  const samples = [];
  for (let index = 0; index < 500; index++) {
    const messages = [{ role: 'user', content: [{ type: 'text', text: '示例'.repeat(100_000) + index }] }];
    let complete = false;
    for await (const chunk of adapter.stream(messages, [], '', { signal: task.signal })) {
      if (chunk.type === 'done') complete = true;
    }
    assert(complete); assert(!task.signal.aborted);
    if (index % 100 === 99) {
      global.gc();
      const sample = { requests, open: responses.size, heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576) };
      samples.push(sample); console.log(JSON.stringify(sample));
    }
  }
  for (let index = 0; index < 100 && responses.size; index++) await delay(10);
  global.gc();
  const retainedBytes = process.memoryUsage().heapUsed - start;
  const result = { requests, closed, open: responses.size, peakOpen, retainedMiB: Math.round(retainedBytes / 1048576), holdOpen };
  console.log(JSON.stringify(result));
  assert.equal(requests, 500); assert.equal(responses.size, 0);
  assert(retainedBytes < 16 * 1048576, 'completed requests retain more than 16 MiB');
  assert(Math.max(...samples.map(sample => sample.heapMiB)) - Math.min(...samples.map(sample => sample.heapMiB)) < 8, 'heap grows across completed requests');
} finally {
  task.abort(); for (const response of responses) response.destroy();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
