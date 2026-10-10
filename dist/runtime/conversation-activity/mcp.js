import { Ajv } from 'ajv';
import { createHash } from 'node:crypto';
import { normalizeMcpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
/** Host-owned connections and serialized handles, independent of renderer lifetime. */
export class ConversationMcpActivities {
    options;
    connections = new Map();
    endpoints = new Set();
    reads = new Map();
    retries = new Map();
    delays = new Map();
    restorations = new Map();
    controllers = new Map();
    disposed = false;
    constructor(options) {
        this.options = options;
    }
    register(connection) {
        const endpoint = connection.tasks?.endpointId;
        if (!endpoint || this.disposed)
            return;
        if (this.connections.get(endpoint) === connection) {
            if (!this.options.externalObserver?.(connection))
                for (const watch of this.options.store.listWatches())
                    if (watch.source === 'mcp' && watch.logicalSourceId === endpoint && watch.status === 'active')
                        void this.restore(watch, connection).catch(error => this.options.onError?.(error));
            return;
        }
        this.endpoints.add(endpoint);
        this.connections.set(endpoint, connection);
        const close = connection.client.onclose;
        connection.client.onclose = () => {
            try {
                close?.();
            }
            finally {
                if (this.connections.get(endpoint) === connection) {
                    this.connections.delete(endpoint);
                    for (const watch of this.options.store.listWatches())
                        if (watch.source === 'mcp' && watch.logicalSourceId === endpoint)
                            void this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_disconnected').catch(error => this.options.onError?.(error));
                }
            }
        };
        for (const watch of this.options.store.listWatches())
            if (!this.options.externalObserver?.(connection) && watch.source === 'mcp' && watch.logicalSourceId === endpoint && watch.status === 'active') {
                void this.restore(watch, connection).catch(error => this.options.onError?.(error));
            }
    }
    canObserve(watch) {
        const reference = this.options.store.getMcpReference(watch.watchId);
        return Boolean(reference && this.endpoints.has(reference.endpointId) && reference.endpointId === watch.logicalSourceId && reference.taskId === watch.workId);
    }
    async userWork(watchId, actor) {
        const { watch } = await this.options.service.getWork(watchId, actor);
        if (watch.source !== 'mcp' || !await this.options.service.canReadSource(watchId))
            throw new Error('activity_source_forbidden');
        const reference = this.options.store.getMcpReference(watchId);
        const connection = reference && this.connections.get(reference.endpointId);
        if (!reference || !connection?.tasks)
            throw new Error('activity_mcp_disconnected');
        return { watch, reference, connection };
    }
    async inputs(watchId, actor) {
        const { reference, connection } = await this.userWork(watchId, actor);
        const task = await connection.tasks.task(reference.taskId).snapshot();
        if (!await this.options.service.canReadSource(watchId))
            throw new Error('activity_source_forbidden');
        if (task.status !== 'input_required')
            return [];
        const requests = task.raw.inputRequests;
        const forms = [];
        for (const [inputId, request] of Object.entries(requests ?? {}).slice(0, 32)) {
            if (request.method !== 'elicitation/create' || !request.params?.requestedSchema)
                continue;
            const schema = request.params.requestedSchema;
            forms.push({ inputId, expectedDigest: createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex'), prompt: (request.params.message ?? '').slice(0, 1024),
                fields: Object.entries(schema.properties ?? {}).slice(0, 32).map(([key, field]) => ({ key, title: (field.title ?? key).slice(0, 256), required: schema.required?.includes(key) ?? false,
                    type: field.type === 'boolean' ? 'boolean' : ['number', 'integer'].includes(field.type ?? '') ? 'number' : field.type === 'array' ? 'choices' : field.enum ? 'choice' : 'text',
                    ...(field.enum || field.items?.enum ? { options: (field.enum ?? field.items?.enum ?? []).filter((value) => typeof value === 'string').slice(0, 128) } : {}) })) });
        }
        return forms;
    }
    async answerInput(watchId, input, actor) {
        const form = (await this.inputs(watchId, actor)).find(form => form.inputId === input.inputId);
        if (!form || form.expectedDigest !== input.expectedDigest)
            throw new Error('activity_mcp_input_stale');
        if (input.action === 'accept') {
            const content = input.content ?? {};
            if (Object.keys(content).some(key => !form.fields.some(field => field.key === key)))
                throw new Error('activity_mcp_input_invalid');
            for (const field of form.fields) {
                const value = content[field.key];
                if (value === undefined && !field.required)
                    continue;
                const valid = field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
                    : field.type === 'boolean' ? typeof value === 'boolean'
                        : field.type === 'choices' ? Array.isArray(value) && value.length <= 128 && value.every(item => typeof item === 'string' && (!field.options || field.options.includes(item)))
                            : typeof value === 'string' && value.length <= 4096 && (!field.options || field.options.includes(value));
                if (!valid)
                    throw new Error('activity_mcp_input_invalid');
            }
        }
        const { watch, reference, connection } = await this.userWork(watchId, actor);
        const latest = await connection.tasks.task(reference.taskId).snapshot();
        const request = latest.raw.inputRequests?.[input.inputId];
        if (latest.status !== 'input_required' || !request || createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex') !== input.expectedDigest)
            throw new Error('activity_mcp_input_stale');
        if (input.action === 'accept') {
            if (!request.params?.requestedSchema || Buffer.byteLength(JSON.stringify(request.params.requestedSchema)) > 64 * 1024)
                throw new Error('activity_mcp_input_invalid');
            try {
                if (!new Ajv({ strict: false, validateFormats: false }).compile(request.params.requestedSchema)(input.content ?? {}))
                    throw new Error('activity_mcp_input_invalid');
            }
            catch {
                throw new Error('activity_mcp_input_invalid');
            }
        }
        if (!await this.options.service.canReadSource(watchId))
            throw new Error('activity_source_forbidden');
        await connection.tasks.task(reference.taskId).updateJson({ [input.inputId]: { action: input.action, ...(input.action === 'accept' ? { content: input.content ?? {} } : {}) } });
        await this.observe(watch, reference, connection);
        void this.restore(watch, connection).catch(error => this.options.onError?.(error));
    }
    async cancel(watchId, actor) {
        const { watch, reference, connection } = await this.userWork(watchId, actor);
        await connection.tasks.cancelTask(reference.taskId);
        await this.observe(watch, reference, connection);
        void this.restore(watch, connection).catch(error => this.options.onError?.(error));
        return { requested: true };
    }
    async observer(taskId, invocationId, connection) {
        if (this.disposed || !connection.tasks?.capabilities.execution)
            return;
        await this.options.endpointReady?.(connection);
        const threadId = await this.options.originThread(taskId);
        if (!threadId)
            return;
        const operationId = `mcp:${invocationId}`;
        await this.options.service.prepareAssociation({ threadId, operationId, creationIdempotencyKey: operationId }, { requestSource: 'user', actorId: this.options.actorId });
        let watch;
        return {
            handle: async (reference) => {
                if (this.disposed || this.connections.get(reference.endpointId) !== connection)
                    throw new Error('activity_mcp_connection_superseded');
                watch = await this.options.service.bindWork({ operationId, watchId: operationId, source: 'mcp', logicalSourceId: reference.endpointId,
                    sourceDataEpoch: operationId, workId: reference.taskId, runId: invocationId }, reference);
                if (!this.options.externalObserver?.(connection))
                    this.schedule(watch, reference, connection);
            },
            event: async (reference) => { if (watch && !this.options.externalObserver?.(connection))
                await this.observe(watch, reference, connection); },
            unavailable: async () => { if (watch)
                await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_mcp_subscription_unavailable'); },
            detached: () => { if (watch && !this.options.externalObserver?.(connection))
                void this.restore(watch, connection).catch(error => this.options.onError?.(error)); },
            immediate: () => { this.options.service.forgetUnboundAssociation(operationId); },
        };
    }
    observe(watch, reference, connection) {
        const existing = this.reads.get(watch.watchId);
        if (existing)
            return existing;
        const pending = (async () => {
            if (!await this.options.service.canReadSource(watch.watchId))
                return;
            const task = await connection.tasks.task(reference.taskId).snapshot(this.controllers.get(watch.watchId)?.signal);
            this.delays.set(watch.watchId, Math.max(30_000, task.suggestedPollIntervalMs ?? 0));
            const current = () => !this.disposed && this.connections.get(reference.endpointId) === connection;
            if (!current())
                return;
            const kind = task.status === 'working' ? 'progress' : task.status;
            const legacyOutcome = task.status === 'completed' && reference.generation === 'v1' ? await connection.tasks.task(reference.taskId).result({ signal: this.controllers.get(watch.watchId)?.signal }) : undefined;
            const result = (legacyOutcome ? ('result' in legacyOutcome ? legacyOutcome.result : undefined) : task.raw.result);
            await this.options.service.acceptEvent(watch.watchId, { schemaVersion: 1,
                eventId: createHash('sha256').update(JSON.stringify(canonical(task.raw))).digest('hex'), source: 'mcp',
                logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: watch.workId, runId: watch.runId,
                transportGeneration: watch.generation, kind, sourceRevision: task.lastUpdatedAt,
                receivedAt: Date.now(), summary: (task.statusMessage ?? (result ? normalizeMcpRuntimeToolResult(result).summary : undefined))?.slice(0, 1024), evidenceRefs: [],
                ...(task.status === 'completed' ? { businessOutcome: result?.isError === true ? 'error' : 'success' } : {}),
            }, current);
            await this.options.service.confirmFreshness(watch.watchId);
        })().finally(() => { if (this.reads.get(watch.watchId) === pending)
            this.reads.delete(watch.watchId); });
        this.reads.set(watch.watchId, pending);
        return pending;
    }
    schedule(watch, reference, connection) {
        if (this.disposed || this.retries.has(watch.watchId))
            return;
        const timer = setTimeout(() => {
            this.retries.delete(watch.watchId);
            const latest = this.options.store.getWatch(watch.watchId);
            const projection = this.options.store.getProjection(watch.watchId);
            if (!latest || latest.status !== 'active' || this.disposed || this.connections.get(reference.endpointId) !== connection
                || projection && ['completed', 'failed', 'cancelled'].includes(projection.executionState))
                return;
            void this.observe(latest, reference, connection).catch(async (error) => {
                this.options.onError?.(error);
                await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_handle_unrecoverable');
            }).finally(() => this.schedule(latest, reference, connection)).catch(error => this.options.onError?.(error));
        }, this.delays.get(watch.watchId) ?? 30_000);
        timer.unref?.();
        this.retries.set(watch.watchId, timer);
    }
    restore(watch, connection) {
        const existing = this.restorations.get(watch.watchId);
        if (existing)
            return existing;
        const pending = this.drive(watch, connection).finally(() => { if (this.restorations.get(watch.watchId) === pending)
            this.restorations.delete(watch.watchId); });
        this.restorations.set(watch.watchId, pending);
        return pending;
    }
    async drive(watch, connection) {
        if (this.controllers.has(watch.watchId) || this.disposed)
            return;
        const reference = this.options.store.getMcpReference(watch.watchId);
        if (!reference || !await this.options.service.canReadSource(watch.watchId))
            return;
        if (this.controllers.has(watch.watchId) || this.disposed)
            return;
        const controller = new AbortController();
        this.controllers.set(watch.watchId, controller);
        const terminal = () => ['completed', 'failed', 'cancelled'].includes(this.options.store.getProjection(watch.watchId)?.executionState ?? '');
        const refresh = async () => {
            await this.observe(watch, reference, connection);
            if (terminal())
                controller.abort(new Error('activity_source_terminal'));
        };
        let stopHints;
        const ended = new Promise(resolve => { if (controller.signal.aborted)
            resolve();
        else
            controller.signal.addEventListener('abort', () => resolve(), { once: true }); });
        let subscription;
        try {
            try {
                stopHints = connection.observeTaskStatus?.(reference.taskId, () => { void refresh().catch(error => this.options.onError?.(error)); });
            }
            catch (error) {
                this.options.onError?.(error);
            } // Bounded hint capacity keeps read-only polling available.
            // Background observation owns no SDK ToolExecution: only official
            // TaskController reads/updates and schema-validated notification hints.
            await refresh();
            this.schedule(watch, reference, connection);
            if (controller.signal.aborted || this.disposed)
                return;
            if (reference.generation !== 'v2' || !connection.listenTaskEvents) {
                await ended;
                return;
            }
            let delay = 1000;
            while (!controller.signal.aborted && !this.disposed) {
                try {
                    subscription = await connection.listenTaskEvents(connection.client, [reference.taskId], { timeout: 5000, signal: controller.signal });
                    await refresh(); // snapshot-after-ACK closes the registration gap
                    if (controller.signal.aborted)
                        break;
                    const reason = await Promise.race([subscription.closed, ended.then(() => 'local')]);
                    if (reason === 'local' || controller.signal.aborted)
                        break;
                    await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_mcp_subscription_unavailable');
                }
                catch (error) {
                    if (controller.signal.aborted || this.disposed)
                        break;
                    this.options.onError?.(error);
                    await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_mcp_subscription_unavailable');
                }
                finally {
                    await subscription?.close();
                    subscription = undefined;
                }
                await Promise.race([ended, new Promise(resolve => { const timer = setTimeout(resolve, delay); timer.unref(); ended.then(() => { clearTimeout(timer); resolve(); }); })]);
                delay = Math.min(30_000, delay * 2);
            }
        }
        catch (error) {
            if (!controller.signal.aborted && !this.disposed) {
                await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_handle_unrecoverable');
                throw error;
            }
        }
        finally {
            stopHints?.();
            await subscription?.close();
            if (this.controllers.get(watch.watchId) === controller)
                this.controllers.delete(watch.watchId);
        }
    }
    stopWatch(watchId) {
        this.controllers.get(watchId)?.abort(new Error('activity_watch_stopped'));
        const timer = this.retries.get(watchId);
        if (timer)
            clearTimeout(timer);
        this.retries.delete(watchId);
    }
    dispose() {
        this.disposed = true;
        for (const controller of this.controllers.values())
            controller.abort(new Error('activity_owner_disposed'));
        for (const timer of this.retries.values())
            clearTimeout(timer);
        this.retries.clear();
        this.connections.clear();
        this.endpoints.clear();
    }
}
