import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { connect } from 'node:net';
import { createObserver } from '../../scripts/evals/local-model-cache/observer.mjs';
import { SseMetrics, summarizeRequest, analyzeWindow } from '../../scripts/evals/local-model-cache/metrics.mjs';
import { evaluateExperiment } from '../../scripts/evals/local-model-cache/decision.mjs';

const event = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`;
const tool = (name, description = 'fixture') => ({ type: 'function', function: { name, description, parameters: { type: 'object' } } });
const body = tools => Buffer.from(JSON.stringify({ model: 'fixture', messages: [{ role: 'system', content: 'SECRET_PROMPT' }], tools }));
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const shutdown = async server => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
const tick = () => new Promise(r => setImmediate(r));

test('SSE: UTF8 / CRLF / role-only / thinking / incomplete tools have distinct boundaries', () => {
  const m = new SseMetrics();
  m.push(Buffer.from(': heartbeat\r\n\r\n' + event({ role: 'assistant', content: '' })), 1);
  assert.equal(m.snapshot().firstEffectiveDeltaMs, null);
  m.push(Buffer.from(event({ reasoning_content: 'SECRET_THINKING' })), 10);
  assert.equal(m.snapshot().firstThinkingMs, 10);
  assert.equal(m.snapshot().firstContentMs, null);
  const utf8 = Buffer.from(event({ content: '正文' }));
  for (const byte of utf8) m.push(Buffer.from([byte]), 20);
  assert.equal(m.snapshot().firstContentMs, 20);
  m.push(Buffer.from(event({ tool_calls: [{ index: 0, function: { name: 'read', arguments: '{}' } }] })), 30);
  assert.equal(m.snapshot().firstCompleteToolMs, null);
  m.push(Buffer.from(event({}, 'tool_calls')), 50);
  assert.equal(m.snapshot().firstCompleteToolMs, 50);
  m.push(Buffer.from('data: [DONE]\n\n'), 60);
  assert.equal(m.snapshot().sawDone, true);
  assert(!JSON.stringify(m.snapshot()).includes('SECRET'));
});

test('SSE: malformed, oversized, partial parallel tool arguments never imply a complete tool', () => {
  const m = new SseMetrics({ maxBytes: 500 });
  m.push(Buffer.from(event({ tool_calls: [{ index: 0, function: { name: 'read', arguments: '{}' } }, { index: 1, function: { name: 'grep', arguments: '{' } }] })), 10);
  m.push(Buffer.from(event({}, 'tool_calls')), 20);
  assert.equal(m.snapshot().firstCompleteToolMs, null);
  m.push(Buffer.from('data: invalid\n\n'), 30);
  assert.equal(m.snapshot().parseErrors, 1);
  m.push(Buffer.from('data: ' + 'x'.repeat(501)), 40);
  assert.equal(m.snapshot().available, false);
});

test('summaries never retain payload; order drift is separated from definitions and owner scope', () => {
  const a = summarizeRequest(body([tool('z'), tool('a')]));
  const b = summarizeRequest(body([tool('a'), tool('z')]));
  const changed = summarizeRequest(body([tool('a', 'different'), tool('z')]));
  assert.equal(a.tools.setHash, b.tools.setHash);
  assert.notEqual(a.tools.orderHash, b.tools.orderHash);
  assert.notEqual(a.tools.setHash, changed.tools.setHash);
  assert(!JSON.stringify(a).includes('SECRET_PROMPT'));
  const wrap = summary => ({ keyId: 'one-window', scopeHash: 'main', endpointHash: 'endpoint', status: 'complete', request: summary });
  const report = analyzeWindow([wrap(a), wrap(b), wrap(changed), { ...wrap(a), scopeHash: 'child' }]);
  assert.equal(report.orderComparisons, 1);
  assert.equal(report.orderDrifts, 1);
  assert.equal(report.toolSetChanges, 1);
  assert.equal(report.decision, 'inconclusive');
  assert.equal(analyzeWindow([{ ...wrap(a), scopeHash: null }, { ...wrap(b), scopeHash: null }]).orderComparisons, 0);
  assert.equal(analyzeWindow([wrap(a), { ...wrap(b), keyId: 'other-key' }]).orderComparisons, 0);
});

test('private digests are keyed; independently collected windows cannot be joined by public hashes', () => {
  const bytes = body([tool('a')]); const one = Buffer.alloc(32, 1); const two = Buffer.alloc(32, 2);
  assert.equal(summarizeRequest(bytes, one).body.hash, createHmac('sha256', one).update(bytes).digest('hex'));
  assert.notEqual(summarizeRequest(bytes, one).body.hash, summarizeRequest(bytes, two).body.hash);
});

test('observer forwards first bytes before EOF, exact unknown body fields/auth/path and redacts logs', async t => {
  const records = []; let upstreamResponse; let received;
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    received = { body: Buffer.concat(chunks), headers: req.headers, method: req.method, url: req.url };
    res.writeHead(201, { 'content-type': 'text/event-stream', 'x-end-to-end': 'kept', connection: 'close, x-private-hop', 'x-private-hop': 'discard' });
    res.write(event({ reasoning_content: 'SECRET_RESPONSE' })); upstreamResponse = res;
  });
  const origin = await listen(upstream);
  const proxy = await createObserver({ upstream: origin, scope: 'main', onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const bytes = Buffer.from('{ "messages":[{"role":"system","content":"SECRET_PROMPT"}], "tools":[], "think":false,"seed":17,"options":{"future":"SECRET_OPTION"} }');
  const req = request(proxy.origin + '/v1/chat/completions?private=SECRET_QUERY', { method: 'POST', headers: { authorization: 'Bearer SECRET_AUTH', cookie: 'SECRET_COOKIE', 'content-type': 'application/json', 'content-length': bytes.length, connection: 'close, x-private-hop', 'x-private-hop': 'discard', 'x-future': 'keep' } });
  req.end(bytes);
  const [res] = await once(req, 'response');
  const chunks = []; res.on('data', c => chunks.push(c));
  await once(res, 'data');
  assert.equal(res.statusCode, 201); assert.equal(res.headers['content-type'], 'text/event-stream');
  assert.equal(res.headers['x-end-to-end'], 'kept'); assert.equal(res.headers['x-private-hop'], undefined);
  assert.equal(received.headers.authorization, 'Bearer SECRET_AUTH'); assert.equal(received.headers.cookie, 'SECRET_COOKIE');
  assert.equal(received.headers['x-private-hop'], undefined); assert.equal(received.headers['x-future'], 'keep');
  assert.equal(received.url, '/v1/chat/completions?private=SECRET_QUERY'); assert.equal(received.method, 'POST');
  assert.deepEqual(received.body, bytes); assert.equal(upstreamResponse.writableEnded, false);
  upstreamResponse.end(event({ content: 'visible' }, 'stop') + 'data: [DONE]\n\n');
  await once(res, 'end'); await tick();
  assert.equal(records.length, 1); assert.equal(records[0].status, 'complete');
  assert.equal(records[0].bodyEquivalent, true); assert.equal(records[0].sensitiveHeadersEquivalent, true);
  assert.equal(records[0].methodPathEquivalent, true);
  assert(!JSON.stringify(records).includes('SECRET'));
  assert(Buffer.concat(chunks).includes(Buffer.from('SECRET_RESPONSE')));
});

test('downstream cancel closes a never-ending upstream and records cancellation once', async t => {
  let closedResolve; const closed = new Promise(r => { closedResolve = r; }); const records = [];
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(event({ content: 'a' })); res.on('close', closedResolve); });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const req = request(proxy.origin + '/v1/chat/completions', { method: 'POST' }); req.end('{}');
  const [res] = await once(req, 'response'); await once(res, 'data'); res.destroy();
  await closed; await tick();
  assert.equal(records.length, 1); assert.equal(records[0].status, 'cancelled');
});

test('401, malformed SSE, upstream truncation and compressed data are never successful cache evidence', async t => {
  let count = 0; const records = [];
  const upstream = createServer((req, res) => {
    req.resume(); ++count;
    if (count === 1) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"SECRET_ERROR"}'); }
    if (count === 2) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(event({ content: 'partial' })); }
    if (count === 3) { res.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' }); res.end('compressed'); }
  });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  for (let i = 0; i < 3; i++) {
    const req = request(proxy.origin, { method: 'POST' }); req.end('{}'); const [res] = await once(req, 'response'); res.resume(); await once(res, 'end');
  }
  await tick();
  assert.equal(records[0].status, 'http_error'); assert.equal(records[1].status, 'incomplete_sse');
  assert.equal(records[2].sse.available, false); assert(!JSON.stringify(records).includes('SECRET'));
});

test('stalled upstream is bounded by explicit deadline and shutdown closes all owned sockets', async t => {
  const records = []; const upstream = createServer(req => req.resume());
  const origin = await listen(upstream);
  const proxy = await createObserver({ upstream: origin, timeouts: { totalMs: 80, connectMs: 50, firstByteMs: 50, idleMs: 50 }, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const req = request(proxy.origin, { method: 'POST' }); req.end('{}');
  const [res] = await once(req, 'response'); res.resume(); await once(res, 'end'); await tick();
  assert.equal(res.statusCode, 504); assert.equal(records[0].status, 'timeout'); assert.equal(records.length, 1);
});

test('slow client backpressure and request over parse limit preserve every transport byte', async t => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 120); const records = []; let received = 0;
  const upstream = createServer(async (req, res) => { for await (const c of req) received += c.length; res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(payload); });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, maxRequestBytes: 64, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const req = request(proxy.origin, { method: 'POST' }); req.end(payload);
  const [res] = await once(req, 'response'); res.pause(); await tick(); let size = 0; res.on('data', c => { size += c.length; }); res.resume(); await once(res, 'end'); await tick();
  assert.equal(size, payload.length); assert.equal(received, payload.length); assert.equal(records[0].request.parseStatus, 'size_limit');
});

test('upstream connection refusal returns a classified failure without leaking target/error details', async t => {
  const server = createServer(); const origin = await listen(server); await shutdown(server); const records = [];
  const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) }); t.after(() => proxy.close());
  const req = request(proxy.origin, { method: 'POST' }); req.end('{}'); const [res] = await once(req, 'response'); res.resume(); await once(res, 'end'); await tick();
  assert.equal(res.statusCode, 502); assert.equal(records[0].status, 'upstream_error');
});

test('actual upstream socket truncation is retained as failure after streamed first content', async t => {
  const records = []; let upstreamResponse;
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(event({ content: 'partial' })); upstreamResponse = res; });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const req = request(proxy.origin, { method: 'POST' }); req.end('{}'); const [res] = await once(req, 'response');
  res.on('error', () => {}); await once(res, 'data'); const closed = new Promise(r => res.once('close', r));
  upstreamResponse.destroy(); await closed; await tick();
  assert.equal(records.length, 1); assert.equal(records[0].status, 'upstream_truncated');
});

test('early 401 while client is still uploading cannot update an already-finalized HMAC', async t => {
  const records = [];
  const upstream = createServer((_req, res) => { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('denied'); });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const socket = connect(new URL(proxy.origin).port, '127.0.0.1'); socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write('POST /v1/chat/completions HTTP/1.1\r\nHost: fixture\r\nContent-Length: 100000\r\n\r\n{');
  await once(socket, 'data');
  socket.end(Buffer.alloc(99999, 120)); await tick(); await tick();
  assert.equal(records.length, 1); assert.equal(records[0].status, 'http_error'); assert.equal(records[0].bodyEquivalent, null);
});

test('malformed content observer callbacks disable diagnostics but do not break SSE transport', async t => {
  const records = []; const expected = event({ content: 'text' }, 'stop') + 'data: [DONE]\n\n';
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(expected); });
  const origin = await listen(upstream); const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r), onContent() { throw new Error('SECRET_CALLBACK'); } });
  t.after(async () => { await proxy.close(); await shutdown(upstream); });
  const req = request(proxy.origin, { method: 'POST' }); req.end('{}'); const [res] = await once(req, 'response'); const chunks = [];
  for await (const c of res) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), expected); assert.equal(records[0].sse.available, false); assert(!JSON.stringify(records).includes('SECRET_CALLBACK'));
});

function experiment() {
  return { scenarios: [{ id: 'print', weight: 1, pairs: Array.from({ length: 20 }, (_, i) => ({ id: String(i), a: { status: 'success', visibleMs: 100, totalMs: 200, outputTokens: 4, stopReason: 'stop', toolRounds: 0, quality: 'pass' }, b: { status: 'success', visibleMs: 80, totalMs: 200, outputTokens: 4, stopReason: 'stop', toolRounds: 0, quality: 'pass' } })) }] };
}

test('fixed paired bootstrap gives hand-computable CI and never grants production authorization', () => {
  const x = evaluateExperiment(experiment());
  assert(Math.abs(x.gain.estimate - 0.2) < 1e-12); assert.deepEqual(x.gain.ci95, [x.gain.estimate, x.gain.estimate]);
  assert.deepEqual(x.totalRegression.ci95, [0, 0]); assert.equal(x.statisticalThresholdMet, true);
  assert.equal(x.decision, 'inconclusive'); assert.equal(x.productionAuthorized, false);
  assert.deepEqual(x, evaluateExperiment(experiment()));
});

test('nonconstant stratified bootstrap matches independent Python statistics reference', () => {
  const arm = (visibleMs, totalMs, outputTokens, toolRounds) => ({ status: 'success', visibleMs, totalMs, outputTokens, toolRounds, stopReason: 'stop', quality: 'pass' });
  const x = { scenarios: [
    { id: 'main', weight: .7, pairs: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, a: arm(100 + i * 7, 300 + i * 10, 5, 1), b: arm(80 + i * 6 + (i % 3) * 3, 299 + i * 10, 5, 1) })) },
    { id: 'child', weight: .3, pairs: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, a: arm(210 + i * 3, 600 + i * 7, 6, 2), b: arm(210 + i * 3 - 10 * (i % 4), 601 + i * 7, 6, 2) })) },
  ] };
  const r = evaluateExperiment(x);
  assert.deepEqual(r.gain, { estimate: 0.12812333864965442, ci95: [0.10237202207305024, 0.141567006509837] });
  assert.deepEqual(r.totalRegression, { estimate: -0.0008395424493651271, ci95: [-0.0008968609865471766, -0.000790748245527495] });
  x.scenarios.reverse(); for (const s of x.scenarios) s.pairs.reverse(); assert.deepEqual(evaluateExperiment(x), r);
});

test('invalid or unmatched samples remain blocking; no dropping failures or implicit success', () => {
  const mutations = [x => x.scenarios[0].pairs.pop(), x => { x.scenarios[0].weight = 0.9; }, x => { x.scenarios[0].pairs[1].id = '0'; }, x => { x.scenarios[0].pairs[0].b.status = 'timeout'; }, x => { x.scenarios[0].pairs[0].b.visibleMs = null; }, x => { x.scenarios[0].pairs[0].b.outputTokens = 3; }, x => { delete x.scenarios[0].pairs[0].b.quality; }, x => { x.scenarios[0].pairs[0].b.totalMs = Infinity; }];
  for (const mutate of mutations) { const x = experiment(); mutate(x); const r = evaluateExperiment(x); assert.equal(r.statisticalThresholdMet, false); assert(r.blockers.length > 0); }
  const same = experiment(); for (const p of same.scenarios[0].pairs) p.b.visibleMs = 100;
  assert.equal(evaluateExperiment(same).statisticalThresholdMet, false);
  const slow = experiment(); for (const p of slow.scenarios[0].pairs) p.b.totalMs = 210;
  assert.equal(evaluateExperiment(slow).statisticalThresholdMet, false);
});
