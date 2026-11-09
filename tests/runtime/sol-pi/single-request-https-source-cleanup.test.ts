import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { createSingleRequestHttpsFetch } from '../../../src/runtime/sol-pi/single-request-https.js';
const fault = vi.hoisted(() => ({ requestCalls: 0, responseCalls: 0, raw: { cleanup: true, tail: Promise.resolve() } }));
vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http');
  return { ...actual,
    ClientRequest: class extends actual.ClientRequest { destroy(): this { fault.requestCalls++; throw fault.raw; } },
    IncomingMessage: class extends actual.IncomingMessage { destroy(error?: Error): this { fault.responseCalls++; Reflect.apply(actual.IncomingMessage.prototype.destroy, this, [error]); return this; } },
  };
});
const cert = readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem', import.meta.url)), key = readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem', import.meta.url));
const active: { server: Server; sockets: Set<Duplex> }[] = [];
afterEach(async () => { for (const { server, sockets } of active.splice(0)) { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } fault.requestCalls = 0; fault.responseCalls = 0; });
it.each(['body-error', 'body-success'] as const)('a request destroy failure still attempts response cleanup and never reports clean success: %s', async mode => {
  const server = createServer({ cert, key }, (_req, res) => { res.write('partial'); if (mode === 'body-success') res.end(); });
  const sockets = new Set<Duplex>(); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); active.push({ server, sockets });
  const url = `https://127.0.0.1:${(server.address() as { port: number }).port}/read`, abort = new AbortController(); let physical: Promise<void> | undefined;
  const fetch = createSingleRequestHttpsFetch({ destination: url, method: 'GET', expectedBody: '', maxResponseBytes: 1024, timeoutMs: 2000, certificateAuthority: cert,
    signal: abort.signal, sourceHooks: { beforeTransport() {}, observeRawFailure() {} }, trackPhysicalDrain(value) { physical = value; } });
  const response = await fetch(url, { method: 'GET' }), body = response.text(); if (mode === 'body-error') abort.abort();
  let failed = false, raw: unknown;
  try { await body; } catch (error) { failed = true; raw = error; }
  await physical;
  expect(fault.requestCalls).toBeGreaterThan(0); expect(fault.responseCalls).toBeGreaterThan(0);
  expect(failed).toBe(true);
  const record = Object.getOwnPropertyDescriptor(raw as object, 'cause')?.value;
  expect(record.unknown).toBe(true); expect(record.secondary).toContainEqual({ kind: 'request_destroy', raw: fault.raw });
});
