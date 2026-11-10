import test from 'node:test';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { providerRequestDigest, loadProviderReplayFixture, startProviderReplay } from './provider-replay.mjs';

const token = 'private_fixture_key_only_123456789';
const request = {
  model: 'gpt-room-fixture', stream: true,
  messages: [{ role: 'user', content: 'PRIVATE_ROOM_CONTEXT' }],
  tools: [{ type: 'function', function: { name: 'getRoomMessagesPage', parameters: { type: 'object', properties: { limit: { type: 'integer' } } } } }],
};
async function fixture(t, technicalFields = []) {
  const root = await mkdtemp(join(tmpdir(), 'provider-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'fixture.json');
  const data = {
    schema: 'xiaok-provider-replay/v1', protocol: 'openai.chat.completions.sse', technicalFields,
    steps: [{
      requestDigest: providerRequestDigest(request),
      chunks: ['data: {"choices":[{"delta":{"content":"fixture complete"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'],
    }],
  };
  const bytes = JSON.stringify(data);
  await writeFile(path, bytes, { mode: 0o600 });
  return { fixturePath: path, expectedSha256: createHash('sha256').update(bytes).digest('hex'), token };
}
const send = (server, body) => fetch(server.origin + '/v1/chat/completions', {
  method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('canonical digest preserves policy, tool schemas, arguments and user content', () => {
  assert.equal(providerRequestDigest(request), providerRequestDigest({ tools: request.tools, messages: request.messages, stream: true, model: request.model }));
  for (const changed of [
    { ...request, messages: [{ role: 'user', content: 'OTHER_CONTEXT' }] },
    { ...request, tools: [] },
    { ...request, temperature: 0 },
    { ...request, messages: [{ role: 'tool', content: 'PRIVATE_ROOM_CONTEXT', tool_call_id: 'other' }] },
  ]) assert.notEqual(providerRequestDigest(request), providerRequestDigest(changed));
  assert.throws(() => providerRequestDigest(request, ['messages.0.content']), /NORMALIZATION_INVALID/);
  assert.throws(() => providerRequestDigest(request, ['tools']), /NORMALIZATION_INVALID/);
});
test('only named valid metadata nonces may be normalized', () => {
  const first = { ...request, metadata: { run_id: '00000000-0000-4000-8000-000000000001' } };
  const second = { ...request, metadata: { run_id: '00000000-0000-4000-8000-000000000002' } };
  assert.equal(providerRequestDigest(first, ['metadata.run_id']), providerRequestDigest(second, ['metadata.run_id']));
  assert.notEqual(providerRequestDigest(first), providerRequestDigest(second));
  assert.throws(() => providerRequestDigest(request, ['metadata.run_id']), /TECHNICAL_FIELD_INVALID/);
});
test('fixture tampering fails before starting a provider endpoint', async t => {
  const spec = await fixture(t);
  await writeFile(spec.fixturePath, '{}', { mode: 0o600 });
  await assert.rejects(startProviderReplay(spec), /FIXTURE_HASH_MISMATCH/);
  await assert.rejects(loadProviderReplayFixture({ ...spec, expectedSha256: '' }), /FIXTURE_HASH_REQUIRED/);
});
test('matching adapter requests receive frozen SSE and complete exactly once', async t => {
  const server = await startProviderReplay(await fixture(t));
  t.after(() => server.close());
  assert.throws(() => server.assertComplete(), /INCOMPLETE/);
  const response = await send(server, request);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data: \[DONE\]/);
  server.assertComplete();
  assert.equal(server.stats().consumed, 1);
  assert.equal(JSON.stringify(server.stats()).includes('PRIVATE_ROOM_CONTEXT'), false);
});
test('changed tool sequence halts replay without exposing request contents', async t => {
  const server = await startProviderReplay(await fixture(t));
  t.after(() => server.close());
  const response = await send(server, { ...request, tools: [] });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /REQUEST_MISMATCH/);
  assert.throws(() => server.assertComplete(), /INCOMPLETE/);
  assert.equal(JSON.stringify(server.stats()).includes('PRIVATE_ROOM_CONTEXT'), false);
  const retry = await send(server, request);
  assert.equal(retry.status, 409);
  await retry.text();
  assert.equal(server.stats().consumed, 0);
});
test('extra requests invalidate an otherwise completed fixture', async t => {
  const server = await startProviderReplay(await fixture(t));
  t.after(() => server.close());
  await (await send(server, request)).text();
  server.assertComplete();
  const extra = await send(server, request);
  assert.equal(extra.status, 409);
  await extra.text();
  assert.throws(() => server.assertComplete(), /INCOMPLETE/);
});

test('cleanup closes only fixture sockets, aborts incomplete requests and is idempotent', async t => {
  const server = await startProviderReplay(await fixture(t));
  t.after(() => server.close());
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(server.origin).port) });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ' + token + '\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{');
  const deadline = Date.now() + 1000;
  while (!server.stats().requests && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(server.stats().requests, 1);
  const closed = server.close();
  assert.equal(server.close(), closed);
  await closed;
  assert.throws(() => server.assertComplete(), /INCOMPLETE/);
});
