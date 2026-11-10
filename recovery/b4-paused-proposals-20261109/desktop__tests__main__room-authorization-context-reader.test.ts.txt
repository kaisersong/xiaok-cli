// @vitest-environment node
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import * as transport from '../../electron/collaboration-room-broker-client.js';

const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });
const projected = (scope: unknown = { kind: 'room_only' }) => ({ ok: true, schema: 'room-authorization-context/v1', room: { roomId: 'room/id' }, source: { roomId: 'room/id', messageId: 'source/id', contextScope: scope } });
const snapshot = { ok: true, room: { roomId: 'room/id', title: 'PRIVATE_TITLE' }, messages: [{ roomId: 'room/id', messageId: 'source/id', text: 'PRIVATE_BODY', contextScope: { kind: 'room_only' } }] };
type ReaderFactory = (options: { token: string; origin: string; fetchImpl?: typeof fetch }) => (roomId: string, roomMessageId: string, signal: AbortSignal) => Promise<Record<string, any>>;
const reader = (origin: string, fetchImpl?: typeof fetch) => {
  const factory = (transport as unknown as { createRoomAuthorizationContextReader: ReaderFactory }).createRoomAuthorizationContextReader;
  expect(factory).toBeTypeOf('function');
  return factory({ token: 'qa-private-token', origin, fetchImpl });
};
async function host(reply: (req: IncomingMessage, ordinal: number) => { status?: number; body: unknown; raw?: boolean }) {
  const calls: { url: string; token?: string; method?: string }[] = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url!, token: req.headers['x-intent-broker-room-token'] as string | undefined, method: req.method });
    const value = reply(req, calls.length);
    res.writeHead(value.status ?? 200, { 'content-type': 'application/json' });
    res.end(value.raw ? String(value.body) : JSON.stringify(value.body));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  stops.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { calls, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
const signal = () => new AbortController().signal;

it('reads one encoded point projection over real HTTP and forwards the private header', async () => {
  const h = await host(() => ({ body: projected() }));
  const result = await reader(h.origin)('room/id', 'source/id', signal());
  expect(result).toMatchObject(projected());
  expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  expect(h.calls).toEqual([{ url: '/rooms/room%2Fid/authorization-context?roomMessageId=source%2Fid', token: 'qa-private-token', method: 'GET' }]);
});

it('uses its real fetch injection seam without changing the selected production origin', async () => {
  const h = await host(() => ({ body: projected() }));
  const origins: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const u = new URL(String(input)); origins.push(u.origin);
    return fetch(h.origin + u.pathname + u.search, init);
  };
  expect((await reader('http://127.0.0.1:4318', fetchImpl)('room/id', 'source/id', signal())).ok).toBe(true);
  expect(origins).toEqual(['http://127.0.0.1:4318']);
});

it('only a real old-broker unknown-route 404 permits one same-origin snapshot fallback', async () => {
  const h = await host((_req, ordinal) => ordinal === 1 ? { status: 404, body: { error: 'not_found' } } : { body: snapshot });
  expect(await reader(h.origin)('room/id', 'source/id', signal())).toMatchObject(projected());
  expect(h.calls.map(x => x.url)).toEqual(['/rooms/room%2Fid/authorization-context?roomMessageId=source%2Fid', '/rooms/room%2Fid']);
});

for (const [name, status, body] of [
  ['unauthorized', 401, { error: 'room_authentication_required' }],
  ['forbidden', 403, { code: 'room_actor_forbidden' }],
  ['room missing', 404, { ok: false, code: 'room_not_found' }],
  ['source missing', 404, { ok: false, code: 'room_message_not_found' }],
  ['business refusal in 200', 200, { ok: false, code: 'room_membership_required' }],
  ['unknown schema', 200, { ...projected(), schema: 'future/v2' }],
  ['wrong room', 200, { ...projected(), room: { roomId: 'foreign' } }],
  ['wrong source room', 200, { ...projected(), source: { ...projected().source, roomId: 'foreign' } }],
  ['wrong source identity', 200, { ...projected(), source: { ...projected().source, messageId: 'foreign' } }],
  ['missing scope field', 200, { ...projected(), source: { roomId: 'room/id', messageId: 'source/id' } }],
  ['false room success', 200, { ...projected(), ok: 'yes' }],
  ['not_found in 200', 200, { error: 'not_found' }],
  ['modified unknown-route body', 404, { error: 'not_found', code: 'room_membership_required' }],
] as const) it(`fails closed without retry/fallback: ${name}`, async () => {
  const h = await host(() => ({ status, body }));
  const result = await reader(h.origin)('room/id', 'source/id', signal());
  expect(result).toMatchObject({ ok: false, code: name === 'source missing' ? 'room_message_not_found' : 'broker_unavailable' });
  expect(h.calls).toHaveLength(1);
});

it('does not normalize nonobject scopes before the existing guard can reject them', async () => {
  for (const scope of [false, 0, [], 'project']) {
    const h = await host(() => ({ body: projected(scope) }));
    expect((await reader(h.origin)('room/id', 'source/id', signal())).source.contextScope).toEqual(scope);
  }
});

it('maps malformed response JSON to broker_unavailable without leaking private text or retrying', async () => {
  const h = await host(() => ({ raw: true, body: 'PRIVATE_PROVIDER_ERROR{broken' }));
  expect(await reader(h.origin)('room/id', 'source/id', signal())).toMatchObject({ ok: false, code: 'broker_unavailable' });
  expect(h.calls).toHaveLength(1);
});

it('aborting after an unsupported response prevents the fallback request', async () => {
  const controller = new AbortController();
  const h = await host(() => ({ status: 404, body: { error: 'not_found' } }));
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const json = response.json.bind(response);
    response.json = async () => { const value = await json(); controller.abort(); return value; };
    return response;
  };
  expect((await reader(h.origin, fetchImpl)('room/id', 'source/id', controller.signal)).ok).toBe(false);
  expect(h.calls).toHaveLength(1);
});

it('fallback also validates room/source identities and retains source-missing code', async () => {
  for (const [value, code] of [[{ ...snapshot, room: { roomId: 'foreign' } }, 'broker_unavailable'], [{ ...snapshot, messages: [] }, 'room_message_not_found']] as const) {
    const h = await host((_req, ordinal) => ordinal === 1 ? { status:404, body:{error:'not_found'} } : { body:value });
    expect(await reader(h.origin)('room/id', 'source/id', signal())).toMatchObject({ ok:false, code });
    expect(h.calls).toHaveLength(2);
  }
});

it('the broad Room client does not expose the new trusted reader', () => {
  expect(Object.keys(transport.createCollaborationRoomBrokerClient({ token:'qa' }))).not.toContain('getRoomAuthorizationContext');
});

it('rejects remote, credential-bearing and path-bearing origins before sending credentials', () => {
  for (const origin of ['https://127.0.0.1:4318','http://example.com','http://127.0.0.1:4318@evil.example','http://user:pass@localhost:4318','http://localhost:4318/path','http://localhost:4318/?origin=elsewhere']) {
    expect(() => reader(origin)).toThrow('broker_origin_invalid');
  }
});

it('does not forward the private header across a real HTTP redirect', async () => {
  const target=await host(()=>({body:projected()}));
  const redirect=createServer((_req,res)=>{res.writeHead(302,{location:target.origin+'/capture'});res.end();});
  redirect.listen(0,'127.0.0.1');await once(redirect,'listening');
  stops.push(async()=>{redirect.closeAllConnections();await new Promise<void>(resolve=>redirect.close(()=>resolve()));});
  const origin=`http://127.0.0.1:${(redirect.address() as {port:number}).port}`;
  expect(await reader(origin)('room/id','source/id',signal())).toEqual({ok:false,code:'broker_unavailable'});
  expect(target.calls).toHaveLength(0);
});
