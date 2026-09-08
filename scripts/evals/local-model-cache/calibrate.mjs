#!/usr/bin/env node
// Transport-only calibration against a fixed fixture; never model/cache ROI.
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createObserver } from './observer.mjs';

const payload = Buffer.from(JSON.stringify({ model: 'calibration', messages: [{ role: 'user', content: 'x'.repeat(43000) }], tools: [] }));
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* preserve upload cost in both arms */ }
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }, 100);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const records = []; const proxy = await createObserver({ upstream: origin, onRecord: r => records.push(r) });
const pairs = [];
const median = xs => { const s = [...xs].sort((a, b) => a - b); return (s[9] + s[10]) / 2; };
async function measure(endpoint) {
  const start = performance.now(); let first = null;
  const req = request(endpoint + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' } });
  req.end(payload); const [res] = await once(req, 'response');
  for await (const _ of res) first ??= performance.now();
  return first - start;
}
try {
  for (let i = 0; i < 20; i++) {
    const pair = {};
    for (const arm of i % 2 ? ['proxy', 'direct'] : ['direct', 'proxy']) pair[arm] = await measure(arm === 'proxy' ? proxy.origin : origin);
    pairs.push(pair);
  }
  const directMedianMs = median(pairs.map(p => p.direct)); const proxyMedianMs = median(pairs.map(p => p.proxy));
  process.stdout.write(JSON.stringify({ kind: 'fixed-fixture-transport-calibration', samples: 20, payloadBytes: payload.length, fixtureDelayMs: 100,
    directMedianMs, proxyMedianMs, addedFraction: proxyMedianMs / directMedianMs - 1, withinOnePercent: proxyMedianMs / directMedianMs - 1 <= .01,
    modelRoiEligible: false, reason: 'fixture_only_no_model_cache_or_output_boundary_calibration', recordsComplete: records.every(r => r.status === 'complete' && r.bodyEquivalent), pairs }, null, 2) + '\n');
} finally { await proxy.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
