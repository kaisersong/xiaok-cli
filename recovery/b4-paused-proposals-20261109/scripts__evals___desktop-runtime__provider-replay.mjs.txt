import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { open } from 'node:fs/promises';

const SCHEMA = 'xiaok-provider-replay/v1';
const DIGEST = /^[a-f0-9]{64}$/;
const TECHNICAL_FIELDS = new Map([
  ['metadata.run_id', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i],
  ['metadata.request_id', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i],
  ['metadata.created_at', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/],
]);
const sha = value => createHash('sha256').update(value).digest('hex');
function fail(code) { throw new Error(code); }

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  fail('PROVIDER_REPLAY_REQUEST_INVALID');
}

/** Never normalizes messages, tools, arguments, model settings or policies. */
export function providerRequestDigest(request, technicalFields = []) {
  if (!request || Array.isArray(request) || typeof request !== 'object') fail('PROVIDER_REPLAY_REQUEST_INVALID');
  if (!Array.isArray(technicalFields) || new Set(technicalFields).size !== technicalFields.length) fail('PROVIDER_REPLAY_NORMALIZATION_INVALID');
  const normalized = JSON.parse(canonical(request));
  for (const field of technicalFields) {
    const pattern = TECHNICAL_FIELDS.get(field);
    if (!pattern) fail('PROVIDER_REPLAY_NORMALIZATION_INVALID');
    const key = field.slice('metadata.'.length);
    const metadata = normalized.metadata;
    if (!metadata || !Object.hasOwn(metadata, key) || typeof metadata[key] !== 'string' || !pattern.test(metadata[key])) {
      fail('PROVIDER_REPLAY_TECHNICAL_FIELD_INVALID');
    }
    metadata[key] = '<technical:' + field + '>';
  }
  return sha(canonical(normalized));
}

export async function loadProviderReplayFixture({ fixturePath, expectedSha256 }) {
  if (!DIGEST.test(expectedSha256 ?? '')) fail('PROVIDER_REPLAY_FIXTURE_HASH_REQUIRED');
  const file = await open(fixturePath, 'r');
  let bytes;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 4 * 1024 * 1024) fail('PROVIDER_REPLAY_FIXTURE_TOO_LARGE');
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > 4 * 1024 * 1024) fail('PROVIDER_REPLAY_FIXTURE_TOO_LARGE');
    bytes = buffer.subarray(0, length);
  } finally { await file.close(); }
  if (sha(bytes) !== expectedSha256) fail('PROVIDER_REPLAY_FIXTURE_HASH_MISMATCH');
  let fixture;
  try { fixture = JSON.parse(bytes); } catch { fail('PROVIDER_REPLAY_FIXTURE_INVALID'); }
  if (fixture?.schema !== SCHEMA || fixture.protocol !== 'openai.chat.completions.sse'
      || !Array.isArray(fixture.technicalFields) || !Array.isArray(fixture.steps)
      || fixture.steps.length < 1 || fixture.steps.length > 256) fail('PROVIDER_REPLAY_FIXTURE_INVALID');
  if (new Set(fixture.technicalFields).size !== fixture.technicalFields.length
      || fixture.technicalFields.some(field => !TECHNICAL_FIELDS.has(field))) fail('PROVIDER_REPLAY_NORMALIZATION_INVALID');
  for (const step of fixture.steps) {
    if (!DIGEST.test(step?.requestDigest ?? '') || !Array.isArray(step.chunks)
        || step.chunks.length < 1 || step.chunks.length > 512
        || step.chunks.some(chunk => typeof chunk !== 'string')
        || Buffer.byteLength(step.chunks.join('')) > 1024 * 1024
        || !step.chunks.join('').endsWith('data: [DONE]\n\n')) fail('PROVIDER_REPLAY_FIXTURE_INVALID');
  }
  return fixture;
}

/** QA-only loopback endpoint for a real provider adapter, never a model call.
 * The caller must supply a frozen fixture hash and a private per-run dummy key.
 * Request bodies/headers are neither stored in diagnostics nor written to disk.
 */
export async function startProviderReplay({ fixturePath, expectedSha256, token }) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) fail('PROVIDER_REPLAY_TOKEN_INVALID');
  const fixture = await loadProviderReplayFixture({ fixturePath, expectedSha256 });
  const expectedAuthorization = Buffer.from('Bearer ' + token);
  const state = { requests: 0, consumed: 0, failureCount: 0, failureCode: null, lastActualDigest: null };
  let active = false;
  let closePromise;
  const reject = (res, code, status = 409) => {
    state.failureCount++;
    state.failureCode ??= code;
    if (!res.destroyed && !res.headersSent) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'provider_fixture_error', code } }));
    }
  };
  const server = createServer((req, res) => {
    const handle = async () => {
      state.requests++;
      if (state.failureCode) { reject(res, 'PROVIDER_REPLAY_ALREADY_FAILED'); return; }
      const authorization = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
      if (authorization.length !== expectedAuthorization.length || !timingSafeEqual(authorization, expectedAuthorization)) {
        reject(res, 'PROVIDER_REPLAY_AUTHORIZATION_INVALID', 401); return;
      }
      if (req.socket.remoteAddress !== '127.0.0.1' || req.method !== 'POST' || req.url !== '/v1/chat/completions'
          || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
        reject(res, 'PROVIDER_REPLAY_TRANSPORT_INVALID'); return;
      }
      if (active) { reject(res, 'PROVIDER_REPLAY_CONCURRENCY_INVALID'); return; }
      if (state.consumed >= fixture.steps.length) { reject(res, 'PROVIDER_REPLAY_EXTRA_REQUEST'); return; }
      active = true;
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) { reject(res, 'PROVIDER_REPLAY_REQUEST_TOO_LARGE', 413); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(res, 'PROVIDER_REPLAY_REQUEST_INVALID'); return; }
        if (body?.stream !== true) { reject(res, 'PROVIDER_REPLAY_STREAM_REQUIRED'); return; }
        let digest;
        try { digest = providerRequestDigest(body, fixture.technicalFields); } catch { reject(res, 'PROVIDER_REPLAY_REQUEST_INVALID'); return; }
        state.lastActualDigest = digest;
        if (state.failureCode) { reject(res, 'PROVIDER_REPLAY_ALREADY_FAILED'); return; }
        const step = fixture.steps[state.consumed];
        if (digest !== step.requestDigest) { reject(res, 'PROVIDER_REPLAY_REQUEST_MISMATCH'); return; }
        state.consumed++;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const chunk of step.chunks) res.write(chunk);
        await new Promise(resolve => {
          res.once('finish', resolve);
          res.once('close', () => {
            if (!res.writableFinished) {
              state.failureCount++;
              state.failureCode ??= 'PROVIDER_REPLAY_CLIENT_DISCONNECTED';
            }
            resolve();
          });
          res.end();
        });
      } finally { active = false; }
    };
    void handle().catch(() => reject(res, 'PROVIDER_REPLAY_REQUEST_INVALID'));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  await new Promise((resolve, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return Object.freeze({
    origin: 'http://127.0.0.1:' + address.port,
    stats: () => Object.freeze({ ...state, expectedSteps: fixture.steps.length }),
    assertComplete() {
      if (active || state.failureCode || state.consumed !== fixture.steps.length || state.requests !== fixture.steps.length) {
        fail('PROVIDER_REPLAY_INCOMPLETE');
      }
    },
    close() {
      if (!closePromise) {
        if (active) {
          state.failureCount++;
          state.failureCode ??= 'PROVIDER_REPLAY_CLOSED_WHILE_ACTIVE';
        }
        closePromise = new Promise((resolve, rejectPromise) => {
          server.close(error => error ? rejectPromise(error) : resolve());
          // These sockets belong only to this private fixture endpoint.
          server.closeAllConnections();
        });
      }
      return closePromise;
    },
  });
}
