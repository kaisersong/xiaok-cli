import { createServer, createConnection } from 'node:net';
import { existsSync, lstatSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { taskId } from '@modelcontextprotocol/ext-tasks/core';
import { ConversationActivityStore } from './store.js';
import { ConversationActivityService } from './service.js';
import { activityOwnerAddress, createActivityOwnerCredentials, authenticateActivityClient, ACTIVITY_OWNER_PROTOCOL, ACTIVITY_REQUEST_BYTES, ACTIVITY_RESPONSE_BYTES } from './owner-protocol.js';
/** Default grace period after the last client/request/watch change. */
export const ACTIVITY_OWNER_IDLE_MS = 20 * 60_000;
/** Bound observation without an authenticated client, including active watches. */
export const ACTIVITY_OWNER_MAX_UNATTENDED_MS = 24 * 60 * 60_000;
/** Polling bounds shutdown latency without keeping the process alive. */
const ACTIVITY_OWNER_IDLE_CHECK_MS = 1000;
export function activityOwnerTimeout(value, fallback) {
    const parsed = Number(value);
    return /^\d+$/.test(value ?? '') && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const key = z.string().min(1).max(256);
const USER_METHODS = new Set(['status', 'list', 'work', 'unread', 'read', 'reporting', 'stop', 'subscribe', 'overview', 'unsubscribe', 'mcpInputs', 'mcpAnswer', 'mcpCancel']);
/** Activity-only owner. It never creates a task, Goal, agent or LLM runner. */
export class ConversationActivityOwnerHost {
    options;
    ownerEpoch = randomUUID();
    address;
    store;
    service;
    server;
    clients = new Set();
    pending = 0;
    stopped = false;
    actor;
    now;
    lastActivity;
    unattendedSince;
    watchState = '';
    idleEmitted = false;
    idleTimer;
    idleMs;
    unattendedMs;
    checkIdle() {
        if (this.stopped || this.idleEmitted || !this.options.idle || this.options.ready?.() === false)
            return;
        const now = this.now();
        const watches = this.store.listWatches().map(watch => ({ watch, projection: this.store.getProjection(watch.watchId) }));
        const state = JSON.stringify(watches);
        if (this.watchState && state !== this.watchState)
            this.lastActivity = now;
        this.watchState = state;
        if ([...this.clients].some(client => client.active && client.role)) {
            this.unattendedSince = now;
            this.lastActivity = now;
            return;
        }
        if (this.pending)
            return;
        const unfinished = watches.some(({ watch, projection }) => watch.status === 'active' && !['completed', 'failed', 'cancelled'].includes(projection?.executionState ?? ''));
        if ((!unfinished && now - this.lastActivity >= this.idleMs) || now - this.unattendedSince >= this.unattendedMs) {
            this.idleEmitted = true;
            this.options.idle();
        }
    }
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.lastActivity = this.unattendedSince = this.now();
        this.idleMs = activityOwnerTimeout((options.env ?? process.env).XIAOK_ACTIVITY_OWNER_IDLE_MS, ACTIVITY_OWNER_IDLE_MS);
        this.unattendedMs = activityOwnerTimeout((options.env ?? process.env).XIAOK_ACTIVITY_OWNER_MAX_UNATTENDED_MS, ACTIVITY_OWNER_MAX_UNATTENDED_MS);
        this.address = activityOwnerAddress(options.dataRoot);
        this.store = new ConversationActivityStore(join(this.address.dataRoot, 'conversation-activity.sqlite'));
        this.actor = { requestSource: 'user', actorId: options.actorId };
        this.service = new ConversationActivityService({ ...options, store: this.store });
    }
    async start() {
        if (this.server)
            return;
        if (this.stopped)
            throw new Error('activity_owner_stopped');
        try {
            if (process.platform !== 'win32' && existsSync(this.address.socketPath)) {
                const live = await new Promise((resolve, reject) => {
                    const socket = createConnection(this.address.socketPath);
                    const timer = setTimeout(() => { socket.destroy(); reject(new Error('activity_socket_probe_timeout')); }, 1000);
                    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
                    socket.once('error', error => {
                        clearTimeout(timer);
                        socket.destroy();
                        if (['ENOENT', 'ECONNREFUSED'].includes(error.code ?? ''))
                            resolve(false);
                        else
                            reject(error);
                    });
                });
                if (live)
                    throw new Error('activity_owner_live_socket');
                if (!lstatSync(this.address.socketPath).isSocket())
                    throw new Error('activity_socket_not_socket');
                // Only after the store's OS lock was acquired and dead-socket proof.
                unlinkSync(this.address.socketPath);
            }
            const credentials = createActivityOwnerCredentials(this.address);
            this.server = createServer(socket => {
                if (this.clients.size >= 64) {
                    socket.destroy();
                    return;
                }
                const client = { id: randomUUID(), socket, buffer: '', active: true, pending: 0, subscriptions: new Map() };
                this.clients.add(client);
                socket.setEncoding('utf8');
                const handshake = setTimeout(() => { if (!client.role)
                    socket.destroy(); }, 2000);
                handshake.unref();
                socket.on('data', (chunk) => {
                    client.buffer += chunk;
                    if (Buffer.byteLength(client.buffer) > ACTIVITY_REQUEST_BYTES) {
                        socket.destroy();
                        return;
                    }
                    for (;;) {
                        const end = client.buffer.indexOf('\n');
                        if (end < 0)
                            break;
                        const line = client.buffer.slice(0, end);
                        client.buffer = client.buffer.slice(end + 1);
                        let message;
                        try {
                            message = JSON.parse(line);
                        }
                        catch {
                            socket.destroy();
                            return;
                        }
                        if (!client.role) {
                            try {
                                client.role = authenticateActivityClient(credentials, message);
                                client.instanceId = message.instanceId;
                                clearTimeout(handshake);
                                this.lastActivity = this.unattendedSince = this.now();
                                this.send(client, { type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: this.address.rootHash, ownerEpoch: this.ownerEpoch });
                            }
                            catch {
                                socket.destroy();
                                return;
                            }
                        }
                        else
                            void this.request(client, message);
                    }
                });
                socket.on('close', () => { if (client.role) {
                    this.lastActivity = this.now();
                    if (![...this.clients].some(other => other !== client && other.active && other.role))
                        this.unattendedSince = this.now();
                } clearTimeout(handshake); client.active = false; this.clients.delete(client); for (const stop of client.subscriptions.values())
                    stop(); client.subscriptions.clear(); void this.options.disconnected?.(client.id).catch(error => this.options.onError?.(error)); });
                socket.on('error', () => socket.destroy());
            });
            await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.address.socketPath, () => { this.server.off('error', reject); resolve(); }); });
            const statusFile = join(this.address.dataRoot, 'activity-owner.status.json');
            writeFileSync(`${statusFile}.${process.pid}.tmp`, JSON.stringify({ ownerEpoch: this.ownerEpoch, pid: process.pid, rootHash: this.address.rootHash }), { mode: 0o600 });
            renameSync(`${statusFile}.${process.pid}.tmp`, statusFile);
            this.service.start();
            this.watchState = JSON.stringify(this.store.listWatches().map(watch => ({ watch, projection: this.store.getProjection(watch.watchId) })));
            if (this.options.idle) {
                this.idleTimer = (this.options.setInterval ?? setInterval)(() => this.checkIdle(), ACTIVITY_OWNER_IDLE_CHECK_MS);
                this.idleTimer.unref();
            }
        }
        catch (error) {
            await this.stop();
            throw error;
        }
    }
    send(client, message) {
        if (!client.active)
            return;
        const encoded = JSON.stringify(message) + '\n';
        if (Buffer.byteLength(encoded) > ACTIVITY_RESPONSE_BYTES || client.socket.writableLength > ACTIVITY_RESPONSE_BYTES) {
            client.socket.destroy();
            return;
        }
        client.socket.write(encoded);
    }
    async request(client, raw) {
        if (!client.active || this.stopped)
            return;
        const parsed = z.object({ type: z.literal('request'), id: key, method: key, params: z.record(z.string(), z.unknown()) }).strict().safeParse(raw);
        if (!parsed.success || client.pending >= 64 || this.pending >= 256) {
            client.socket.destroy();
            return;
        }
        const { id, method, params } = parsed.data;
        client.pending++;
        this.pending++;
        this.lastActivity = this.now();
        try {
            if (client.role === 'user' && !USER_METHODS.has(method))
                throw new Error('activity_method_forbidden');
            const result = await this.dispatch(client, method, params);
            if (client.active)
                this.send(client, { type: 'result', id, result });
        }
        catch (error) {
            this.send(client, { type: 'error', id, code: error instanceof Error ? error.message.slice(0, 256) : 'activity_request_failed' });
        }
        finally {
            client.pending--;
            this.pending--;
            this.lastActivity = this.now();
        }
    }
    async dispatch(client, method, params) {
        const service = this.service, actor = this.actor;
        const producerWatch = (watchId) => {
            const watch = this.store.getWatch(watchId);
            if (client.role !== 'producer' || !watch || !client.active || this.stopped || !this.options.authorizeProducer(watch.origin.threadId, client.instanceId))
                throw new Error('activity_producer_forbidden');
            return () => client.active && !this.stopped && this.options.authorizeProducer(watch.origin.threadId, client.instanceId);
        };
        switch (method) {
            case 'status':
                z.object({}).strict().parse(params);
                return { ownerEpoch: this.ownerEpoch, rootHash: this.address.rootHash, profileId: this.options.profileId, pid: process.pid, configDigest: this.options.configDigest, ready: this.options.ready?.() ?? true };
            case 'list': {
                const input = z.object({ threadId: key, afterLocalSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict().parse(params);
                return service.listActivities(input.threadId, actor, input);
            }
            case 'work': return service.getWork(z.object({ watchId: key }).strict().parse(params).watchId, actor);
            case 'unread':
                z.object({}).strict().parse(params);
                return service.unreadThreads(actor);
            case 'read': {
                const input = z.object({ threadId: key, through: z.number().int().nonnegative() }).strict().parse(params);
                return service.markRead(input.threadId, input.through, actor);
            }
            case 'reporting': {
                const input = z.object({ watchId: key, preference: z.enum(['normal', 'critical_only', 'quiet']), revision: z.number().int().nonnegative() }).strict().parse(params);
                return service.updateReporting(input.watchId, input.preference, input.revision, actor);
            }
            case 'stop': {
                const input = z.object({ watchId: key, revision: z.number().int().nonnegative() }).strict().parse(params);
                const result = await service.stopWatch(input.watchId, input.revision, actor);
                this.options.stopWatch?.(input.watchId);
                return result;
            }
            case 'subscribe': {
                const input = z.object({ threadId: key, subscriptionId: key }).strict().parse(params);
                client.subscriptions.get(input.subscriptionId)?.();
                client.subscriptions.set(input.subscriptionId, service.subscribe(input.threadId, actor, change => this.send(client, { type: 'change', subscriptionId: input.subscriptionId, change })));
                return;
            }
            case 'unsubscribe': {
                const input = z.object({ subscriptionId: key }).strict().parse(params);
                client.subscriptions.get(input.subscriptionId)?.();
                client.subscriptions.delete(input.subscriptionId);
                return;
            }
            case 'overview': {
                const input = z.object({ subscriptionId: key }).strict().parse(params);
                client.subscriptions.get(input.subscriptionId)?.();
                client.subscriptions.set(input.subscriptionId, service.subscribeOverview(actor, change => this.send(client, { type: 'change', subscriptionId: input.subscriptionId, change })));
                return;
            }
            case 'prepare': {
                const input = z.object({ threadId: key, operationId: key, creationIdempotencyKey: key }).strict().parse(params);
                if (client.role !== 'producer' || !this.options.authorizeProducer(input.threadId, client.instanceId) || !client.active)
                    throw new Error('activity_producer_forbidden');
                return service.prepareAssociation(input, actor);
            }
            case 'bind': {
                if (client.role !== 'producer')
                    throw new Error('activity_producer_forbidden');
                const parsed = z.object({ operationId: key, watchId: key, source: z.enum(['kswarm', 'task_host', 'agent_group', 'mcp']), logicalSourceId: key, sourceDataEpoch: key, workId: key, runId: key.optional(), actualExecutionThreadId: key.optional(), mcpReference: z.object({ endpointId: key, generation: z.enum(['v1', 'v2']), taskId: key, originalOperation: z.literal('tools/call') }).strict().optional() }).strict().parse(params);
                const { mcpReference, ...input } = parsed;
                const origin = this.store.getAssociation(input.operationId)?.origin;
                if (!origin || !this.options.authorizeProducer(origin.threadId, client.instanceId) || !client.active)
                    throw new Error('activity_producer_forbidden');
                const reference = mcpReference ? (mcpReference.generation === 'v1' ? { ...mcpReference, taskId: taskId(mcpReference.taskId), generation: 'v1' } : { ...mcpReference, taskId: taskId(mcpReference.taskId), generation: 'v2' }) : undefined;
                const watch = await service.bindWork(input, reference);
                await this.options.watchBound?.(watch.watchId);
                return watch;
            }
            case 'ingest': {
                if (client.role !== 'producer')
                    throw new Error('activity_producer_forbidden');
                const input = z.object({ watchId: key, event: z.unknown() }).strict().parse(params);
                const watch = this.store.getWatch(input.watchId);
                if (!watch || !this.options.authorizeProducer(watch.origin.threadId, client.instanceId))
                    throw new Error('activity_producer_forbidden');
                return service.acceptEvent(input.watchId, input.event, () => client.active && !this.stopped && this.options.authorizeProducer(watch.origin.threadId, client.instanceId));
            }
            case 'retainedPage': {
                const input = z.object({ watchId: key, page: z.object({ sourceDataEpoch: key, coveredThrough: z.number().int().nonnegative(), events: z.array(z.unknown()).max(200), gapRanges: z.array(z.object({ from: z.number().int().positive(), through: z.number().int().positive(), reason: z.enum(['progress_compacted', 'retention_expired', 'mixed_retention_compaction']) }).strict()).max(201) }).strict() }).strict().parse(params);
                const current = producerWatch(input.watchId);
                return service.acceptRetainedPage(input.watchId, input.page, current);
            }
            case 'reconcile': {
                const input = z.object({ watchId: key, epoch: key, sequence: z.number().int().nonnegative(), state: z.enum(['accepted', 'queued', 'running', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']), historyGap: z.boolean() }).strict().parse(params);
                const current = producerWatch(input.watchId);
                return service.reconcileSnapshot(input.watchId, input.epoch, input.sequence, input.state, input.historyGap, current);
            }
            case 'presented': {
                const input = z.object({ threadId: key, surface: z.literal('cli'), through: z.number().int().nonnegative() }).strict().parse(params);
                if (client.role !== 'producer' || !this.options.authorizeProducer(input.threadId, client.instanceId))
                    throw new Error('activity_producer_forbidden');
                this.store.markPresented(this.options.profileId, input.threadId, input.surface, input.through);
                return;
            }
            case 'mcpRegister':
            case 'mcpInputs':
            case 'mcpAnswer':
            case 'mcpCancel': {
                if (method === 'mcpRegister' && client.role !== 'producer' || !this.options.mcpRequest)
                    throw new Error('activity_method_forbidden');
                return this.options.mcpRequest(method, params, client.id);
            }
            case 'sourceProtected':
            case 'sourceRestart':
            case 'sourceEnsure': {
                if (client.role !== 'producer' || !this.options.sourceControl)
                    throw new Error('activity_method_forbidden');
                return this.options.sourceControl(method, params);
            }
            case 'hint': {
                if (client.role !== 'producer')
                    throw new Error('activity_producer_forbidden');
                const input = z.object({ source: z.enum(['kswarm', 'agent_group']), workId: key }).strict().parse(params);
                await this.options.sourceHint?.(input.source, input.workId);
                return;
            }
            case 'canReadSource': {
                const { watchId } = z.object({ watchId: key }).strict().parse(params);
                producerWatch(watchId);
                return service.canReadSource(watchId);
            }
            case 'freshness': {
                const { watchId } = z.object({ watchId: key }).strict().parse(params);
                producerWatch(watchId);
                return service.confirmFreshness(watchId);
            }
            case 'unavailable': {
                if (client.role !== 'producer')
                    throw new Error('activity_method_forbidden');
                const input = z.object({ watchId: key, freshness: z.enum(['reconnecting', 'unavailable']), errorCode: key }).strict().parse(params);
                producerWatch(input.watchId);
                return service.sourceUnavailable(input.watchId, input.freshness, input.errorCode);
            }
            case 'forgetAssociation': {
                if (client.role !== 'producer')
                    throw new Error('activity_method_forbidden');
                const input = z.object({ operationId: key }).strict().parse(params);
                const association = this.store.getAssociation(input.operationId);
                if (!association || !this.options.authorizeProducer(association.origin.threadId, client.instanceId))
                    throw new Error('activity_producer_forbidden');
                return service.forgetUnboundAssociation(input.operationId);
            }
            case 'deleted': {
                if (client.role !== 'producer')
                    throw new Error('activity_method_forbidden');
                const input = z.object({ threadId: key, operationId: key }).strict().parse(params);
                const thread = this.options.getThread(input.threadId);
                if (!thread || thread.deleteState === 'none')
                    throw new Error('activity_deletion_unconfirmed');
                return service.handleThreadDeletion(input.threadId, input.operationId);
            }
            default: throw new Error('activity_method_forbidden');
        }
    }
    async stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        if (this.idleTimer)
            (this.options.clearInterval ?? clearInterval)(this.idleTimer);
        this.service.dispose();
        for (const client of this.clients)
            client.socket.destroy();
        if (this.server)
            await new Promise(resolve => this.server.close(() => resolve()));
        this.store.close();
    }
}
