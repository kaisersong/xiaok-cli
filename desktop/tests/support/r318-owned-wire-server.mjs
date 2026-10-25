import { createServer } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
const root = process.env.R318_ROOT, nonce = process.env.R318_NONCE;
if (!root || !nonce || !process.send) throw Error('r318_owned_ipc_required');
const clients = new Set(), rawSockets = new Set(), upgrades = new Set(), responses = new Set(), wireSockets = new Map(), waiters = [];
const modes = { holdRegistrationBody: false, holdIntentHeaders: false, holdIntentBody: false, failRegistration: false, dropIntents: false };
let requests = 0, registrations = 0, intents = 0, wsOpened = 0, wsClosed = 0, wireSent = 0, heldUpgrade = false;
const eventData = JSON.stringify({ type: 'new_intent', event: { kind: 'readiness_probe', fromParticipantId: 'r318-own-wire', payload: { probeId: 'r318-own-probe', agentId: 'r318-own-data' } } });
function log(kind, data = {}) { appendFileSync(join(root, 'wire-events.jsonl'), JSON.stringify({ at: Date.now(), pid: process.pid, nonce, kind, ...data }) + '\n', { mode: 0o600 }); }
function stats() { return { requests, registrations, intents, wsOpened, wsClosed, wireSent, activeResponses: responses.size, activeWebSockets: clients.size, heldUpgrades: upgrades.size, rawSockets: rawSockets.size, protocolIdle: responses.size || clients.size || upgrades.size ? 0 : 1, pausedReads: [...wireSockets.values()].filter(socket => socket.isPaused()).length }; }
function reply(message, data) { process.send?.({ type: 'reply', nonce, id: message.id, data }); }
function changed() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const value = waiters[i], actual = stats()[value.key];
    if (typeof actual === 'number' && actual >= value.minimum) { waiters.splice(i, 1); reply(value.message, stats()); }
  }
}
function finishResponse(item, drop = false) {
  if (item.finished) return;
  if (drop) { item.response.destroy(); return; }
  if (item.phase === 'headers') item.response.writeHead(item.status, { 'content-type': 'application/json' });
  item.response.end(item.phase === 'body' ? '}' : JSON.stringify({ ok: item.status === 200 }));
}
const http = createServer((request, response) => {
  requests++;
  const item = { response, path: request.url, phase: 'headers', status: request.url === '/participants/register' && modes.failRegistration ? 500 : 200, finished: false };
  responses.add(item);
  const ended = () => { if (item.finished) return; item.finished = true; responses.delete(item); log('http-response-closed', { path: item.path }); changed(); };
  response.once('close', ended);
  void (async () => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8'); if (text) JSON.parse(text);
    if (request.url === '/participants/register') registrations++;
    else if (request.url === '/intents') intents++;
    else { item.status = 404; finishResponse(item); changed(); return; }
    log('http-request', { path: item.path });
    if (request.url === '/intents' && modes.dropIntents) { response.destroy(); changed(); return; }
    if (request.url === '/intents' && modes.holdIntentHeaders) { changed(); return; }
    const holdBody = request.url === '/participants/register' ? modes.holdRegistrationBody : modes.holdIntentBody;
    if (holdBody) { response.writeHead(item.status, { 'content-type': 'application/json' }); response.write('{"ok":true'); item.phase = 'body'; }
    else finishResponse(item);
    changed();
  })().catch(error => { log('http-handler-error', { code: error instanceof Error ? error.name : 'unknown' }); response.destroy(); });
});
http.on('connection', socket => { rawSockets.add(socket); socket.once('close', () => { rawSockets.delete(socket); changed(); }); });
const wsServer = new WebSocketServer({ noServer: true });
wsServer.on('connection', socket => {
  clients.add(socket); wsOpened++; log('ws-open'); changed();
  socket.on('error', error => log('ws-error', { code: error.name }));
  socket.once('close', () => { clients.delete(socket); wireSockets.delete(socket); wsClosed++; log('ws-close'); changed(); });
});
function acceptUpgrade(item) {
  upgrades.delete(item);
  if (item.socket.destroyed) return;
  wsServer.handleUpgrade(item.request, item.socket, item.head, socket => { wireSockets.set(socket, item.socket); wsServer.emit('connection', socket, item.request); }); changed();
}
http.on('upgrade', (request, socket, head) => {
  socket.on('error', error => log('upgrade-socket-error', { code: error.name }));
  const item = { request, socket, head }; upgrades.add(item);
  socket.once('close', () => { upgrades.delete(item); changed(); });
  if (!heldUpgrade) acceptUpgrade(item); else { log('ws-upgrade-held'); changed(); }
});
function releaseAll() { modes.holdRegistrationBody = false; modes.holdIntentHeaders = false; modes.holdIntentBody = false; modes.failRegistration = false; modes.dropIntents = false; heldUpgrade = false; for (const socket of wireSockets.values()) socket.resume(); for (const item of [...upgrades]) acceptUpgrade(item); for (const item of [...responses]) finishResponse(item); }
process.on('message', message => {
  if (!message || message.nonce !== nonce || typeof message.id !== 'string') return;
  const fail = error => process.send?.({ type: 'reply', nonce, id: message.id, error: error instanceof Error ? error.message : 'own_wire_command_failed' });
  try {
    if (message.command === 'stats') { reply(message, stats()); return; }
    if (message.command === 'eventData') { reply(message, eventData); return; }
    if (message.command === 'configure') {
      for (const key of Object.keys(modes)) if (typeof message.data?.[key] === 'boolean') modes[key] = message.data[key];
      if (typeof message.data?.holdUpgrade === 'boolean') heldUpgrade = message.data.holdUpgrade;
      reply(message, stats()); return;
    }
    if (message.command === 'wait') {
      const key = message.data?.key, minimum = message.data?.minimum;
      if (typeof stats()[key] !== 'number' || typeof minimum !== 'number') throw Error('owned_wait_input');
      if (stats()[key] >= minimum) reply(message, stats()); else waiters.push({ message, key, minimum }); return;
    }
    if (message.command === 'send') { for (const client of clients) { client.send(eventData); wireSent++; } changed(); reply(message, stats()); return; }
    if (message.command === 'releaseHttp' || message.command === 'dropHttp') {
      if (message.command === 'dropHttp' && message.data?.path === '/intents') modes.dropIntents = true;
      for (const item of [...responses]) if (!message.data?.path || message.data.path === item.path) finishResponse(item, message.command === 'dropHttp');
      reply(message, stats()); return;
    }
    if (message.command === 'pauseReads' || message.command === 'resumeReads') {
      for (const socket of wireSockets.values()) { if (message.command === 'pauseReads') socket.pause(); else socket.resume(); }
      reply(message, stats()); return;
    }
    if (message.command === 'releaseAll') { releaseAll(); reply(message, stats()); return; }
    if (message.command === 'shutdown') {
      if (responses.size || clients.size || upgrades.size) throw Error('owned_wire_resources_still_active');
      void (async () => {
        // Server.close callbacks can precede each socket's real close event.
        // Observe the actual owned sockets before closing; never clear/fake the census.
        const rawClosed = [...rawSockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
        const results = await Promise.allSettled([
          ...rawClosed,
          new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve())),
          new Promise((resolve, reject) => wsServer.close(error => error ? reject(error) : resolve())),
        ]);
        const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'owned_wire_shutdown_failed');
        writeFileSync(join(root, 'wire-closed.json'), JSON.stringify({ pid: process.pid, nonce, stats: stats() }), { mode: 0o600, flag: 'wx' });
        process.send?.({ type: 'reply', nonce, id: message.id, data: { closed: true } }, error => { if (error) process.exitCode = 1; if (process.connected) process.disconnect(); });
      })().catch(fail); return;
    }
    throw Error('owned_wire_command_unknown');
  } catch (error) { fail(error); }
});
process.once('exit', code => writeFileSync(join(root, 'exited.json'), JSON.stringify({ pid: process.pid, nonce, code }), { mode: 0o600, flag: 'wx' }));
http.listen(0, '127.0.0.1', () => {
  const address = http.address(); if (!address || typeof address === 'string') throw Error('own_wire_port_missing');
  process.send?.({ type: 'ready', pid: process.pid, nonce, port: address.port });
});
