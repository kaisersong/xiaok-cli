import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { digest, summarizeRequest, SseMetrics } from './metrics.mjs';

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function endToEnd(headers) {
  const excluded = new Set([...HOP, ...String(headers.connection ?? '').toLowerCase().split(',').map(s => s.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !excluded.has(k.toLowerCase())));
}
const limits = { connectMs: 10_000, firstByteMs: 300_000, idleMs: 300_000, totalMs: 900_000 };

export async function createObserver({ upstream, scope = null, onRecord = () => {}, onStart = () => {}, onContent = () => {}, timeouts = {}, maxRequestBytes = 8 * 1024 * 1024 } = {}) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('upstream_must_be_plain_origin');
  const timeoutLimits = { ...limits, ...timeouts };
  if (Object.keys(timeoutLimits).some(k => !Object.hasOwn(limits, k)) || Object.values(timeoutLimits).some(n => !Number.isSafeInteger(n) || n <= 0 || n > 86_400_000)) throw new Error('invalid_timeouts');
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 64 * 1024 * 1024) throw new Error('invalid_request_parse_limit');
  const key = randomBytes(32); const keyId = randomUUID(); const pending = new Set(); const sockets = new Set();
  let serial = 0; let fatalError = null; let closePromise;
  const server = http.createServer((req, res) => {
    const start = performance.now(); const requestId = ++serial; const timers = new Map();
    const elapsed = () => performance.now() - start;
    let upstreamRequest; let upstreamResponse; let incomingTap; let outgoingTap;
    let finalized = false; let requestEnded = false; let requestForwarded = false;
    let upstreamEndMs = null; let downstreamEndMs = null;
    let size = 0; let chunks = []; let statusCode = null; let firstResponseByteMs = null; let headersMs = null;
    const inbound = createHmac('sha256', key); const outbound = createHmac('sha256', key);
    const sse = new SseMetrics({ onContent: delta => onContent({ requestId, delta }) }); let isSse = false;
    const headers = { ...endToEnd(req.headers), host: target.host };
    const sensitiveHeadersEquivalent = ['authorization', 'cookie'].every(k => headers[k] === req.headers[k]);
    function clear(name) { clearTimeout(timers.get(name)); timers.delete(name); }
    function deadline(name, ms) { if (finalized) return; clear(name); timers.set(name, setTimeout(() => fail('timeout', 504, name), ms)); }
    function finish(status, timeoutKind = null) {
      if (finalized) return; finalized = true; for (const name of timers.keys()) clear(name); pending.delete(cancel);
      if (!requestForwarded) {
        req.unpipe(incomingTap); incomingTap?.unpipe(outgoingTap); outgoingTap?.unpipe(upstreamRequest);
        upstreamRequest?.destroy(); req.resume();
      }
      const inputHash = inbound.digest('hex'); const outputHash = outbound.digest('hex');
      let summary = { parseStatus: size > maxRequestBytes ? 'size_limit' : 'incomplete_request', body: { bytes: size, hash: inputHash } };
      if (requestEnded && size <= maxRequestBytes) summary = summarizeRequest(Buffer.concat(chunks), key);
      chunks = [];
      const record = { version: 1, keyId, requestId, startedAtMonotonicMs: start,
        endpointHash: digest(target.origin, key), scopeHash: scope ? digest(scope, key) : null,
        pathQueryHash: digest(req.url ?? '/', key), methodHash: digest(req.method ?? 'GET', key),
        methodPathEquivalent: Boolean(upstreamRequest) && upstreamRequest.method === req.method && upstreamRequest.path === req.url,
        sensitiveHeadersEquivalent, bodyEquivalent: requestEnded && requestForwarded ? inputHash === outputHash : null,
        outgoingBodyHash: requestForwarded ? outputHash : null, request: summary, status, statusCode, timeoutKind,
        timeouts: timeoutLimits, headersMs, firstResponseByteMs, streamEndMs: upstreamEndMs, downstreamEndMs, elapsedMs: elapsed(), sse: sse.snapshot() };
      if (!fatalError) {
        try { onRecord(record); } catch { fatalError = new Error('record_write_failed'); queueMicrotask(() => { for (const cancel of pending) cancel(); server.closeAllConnections(); server.close(); }); }
      }
    }
    function fail(status, httpCode, timeoutKind = null) {
      finish(status, timeoutKind); upstreamRequest?.destroy(); upstreamResponse?.destroy();
      if (!res.headersSent && !res.destroyed) { res.writeHead(httpCode, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: status })); }
      else res.destroy();
      req.resume();
    }
    function cancel() { finish('cancelled'); upstreamRequest?.destroy(); upstreamResponse?.destroy(); res.destroy(); }
    pending.add(cancel);
    if (!req.url?.startsWith('/') || req.method === 'CONNECT') { fail('unsupported_request', 400); return; }
    try { onStart({ requestId, startedAtMonotonicMs: start }); } catch { fail('observer_callback_error', 500); return; }
    deadline('totalMs', timeoutLimits.totalMs); deadline('connectMs', timeoutLimits.connectMs);
    deadline('firstByteMs', timeoutLimits.firstByteMs); deadline('idleMs', timeoutLimits.idleMs);
    const transport = target.protocol === 'https:' ? https : http;
    upstreamRequest = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port,
      method: req.method, path: req.url, headers, agent: false }, response => {
      upstreamResponse = response; statusCode = response.statusCode ?? 502; headersMs = elapsed(); clear('connectMs');
      isSse = /^text\/event-stream(?:\s*;|$)/i.test(String(response.headers['content-type'] ?? ''))
        && (!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity');
      if (!isSse) sse.disable();
      res.writeHead(statusCode, endToEnd(response.headers)); res.flushHeaders();
      const tap = new Transform({ transform(chunk, _encoding, callback) {
        firstResponseByteMs ??= elapsed(); clear('firstByteMs'); deadline('idleMs', timeoutLimits.idleMs);
        if (isSse) { try { sse.push(chunk, elapsed()); } catch { sse.disable(); } } callback(null, chunk);
      } });
      response.on('error', () => fail('upstream_error', 502));
      response.on('aborted', () => fail('upstream_truncated', 502));
      response.on('end', () => { upstreamEndMs = elapsed(); });
      response.pipe(tap).pipe(res);
    });
    upstreamRequest.on('socket', socket => {
      const event = target.protocol === 'https:' ? 'secureConnect' : 'connect';
      socket.once(event, () => clear('connectMs'));
    });
    upstreamRequest.on('error', () => fail('upstream_error', 502));
    incomingTap = new Transform({ transform(chunk, _encoding, callback) {
      if (finalized) { callback(); return; }
      size += chunk.length; inbound.update(chunk);
      if (size <= maxRequestBytes) chunks.push(Buffer.from(chunk)); else chunks = [];
      deadline('idleMs', timeoutLimits.idleMs); callback(null, chunk);
    } });
    outgoingTap = new Transform({ transform(chunk, _encoding, callback) { if (finalized) { callback(); return; } outbound.update(chunk); callback(null, chunk); } });
    outgoingTap.once('end', () => { requestForwarded = true; });
    req.once('end', () => { requestEnded = true; });
    req.on('aborted', cancel); req.on('error', cancel);
    res.on('finish', () => {
      downstreamEndMs = elapsed();
      const m = sse.snapshot();
      finish(statusCode >= 400 ? 'http_error' : statusCode >= 300 ? 'redirect' : isSse && (m.providerError || m.parseErrors || !m.sawDone || !m.available) ? 'incomplete_sse' : 'complete');
    });
    res.on('close', () => { if (!res.writableFinished) cancel(); });
    req.pipe(incomingTap).pipe(outgoingTap).pipe(upstreamRequest);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}`, keyId,
    privateDigest: value => digest(value, key),
    get error() { return fatalError; },
    close() {
      closePromise ??= new Promise(resolve => { for (const cancel of [...pending]) cancel(); for (const socket of sockets) socket.destroy(); server.close(() => resolve()); });
      return closePromise;
    } };
}
