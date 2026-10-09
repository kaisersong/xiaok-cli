import { createPrivateActivityDirectory } from './storage-permissions.js';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { ConversationActivityOwnerHost } from './owner-host.js';
import { ActivityNativeIdentityRepository } from './native-identity.js';
import { ActivityTaskSnapshotReader, ActivityNativeGroupReader } from './owner-sources.js';
import { ConversationActivitySources } from './sources.js';
import { ActivityOwnerMcp } from './owner-mcp.js';
import { z } from 'zod';
import { showActivityOwnerNotification } from './owner-notification.js';
import { ActivitySourceSupervisor } from './source-supervisor.js';
export function activityOwnerConfigDigest(config) {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
    return createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex');
}
/** Private configuration is supplied by the verified native bootstrap owner. */
export async function startConversationActivityOwner(config, options = {}) {
    if (config.schemaVersion !== 1)
        throw new Error('activity_owner_config_unsupported');
    createPrivateActivityDirectory(config.dataRoot);
    const identity = new ActivityNativeIdentityRepository({ ...config.identity, profileId: config.profileId });
    const tasks = new ActivityTaskSnapshotReader(join(config.dataRoot, 'tasks'));
    const groups = config.identity.kind === 'desktop' ? new ActivityNativeGroupReader(config.identity.path) : undefined;
    let sources;
    let ready = false;
    let mcp;
    let supervisor;
    const request = async (base, path, headers, signal) => {
        const response = await fetch(`${base}${path}`, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
        if (!response.ok)
            throw new Error('activity_source_request_failed');
        return response.json();
    };
    const ks = config.kswarm;
    const host = new ConversationActivityOwnerHost({ dataRoot: config.dataRoot, profileId: config.profileId, actorId: config.actorId, configDigest: activityOwnerConfigDigest(config),
        idle: options.idle,
        disconnected: clientId => mcp.disconnected(clientId),
        mcpRequest: async (method, params, clientId) => {
            if (method === 'mcpRegister')
                return mcp.register(params, clientId);
            const actor = { requestSource: 'user', actorId: config.actorId };
            if (method === 'mcpAnswer') {
                const input = z.object({ watchId: z.string().min(1).max(256), input: z.object({ inputId: z.string().min(1).max(256), expectedDigest: z.string().length(64), action: z.enum(['accept', 'decline', 'cancel']), content: z.record(z.string(), z.unknown()).optional() }).strict() }).strict().parse(params);
                return mcp.activities.answerInput(input.watchId, input.input, actor);
            }
            const input = z.object({ watchId: z.string().min(1).max(256) }).strict().parse(params);
            return method === 'mcpInputs' ? mcp.activities.inputs(input.watchId, actor) : mcp.activities.cancel(input.watchId, actor);
        },
        ready: () => ready, notify: showActivityOwnerNotification,
        sourceControl: async (method, params) => {
            if (method === 'sourceProtected') {
                if (Object.keys(params).length !== 1 || !Number.isSafeInteger(params.pid) || Number(params.pid) <= 0)
                    throw new Error('activity_source_request_invalid');
                return supervisor.protectedPid(Number(params.pid));
            }
            if (Object.keys(params).some(key => !['name', 'ownerEpoch'].includes(key)) || params.ownerEpoch !== host.ownerEpoch || !['kswarm', 'broker'].includes(String(params.name)))
                throw new Error('activity_source_stale_lease');
            const source = config.managedSources?.find(item => item.name === params.name);
            if (!source)
                throw new Error('activity_source_not_managed');
            if (method === 'sourceRestart')
                await supervisor.stopOwned(source.name, host.ownerEpoch);
            return supervisor.ensure(source);
        },
        getThread: threadId => identity.getThread(threadId), authorizeProducer: (threadId, instanceId) => identity.authorizeProducer(threadId, instanceId),
        canObserveWork: async (watch) => {
            if (watch.source === 'task_host')
                return (await tasks.snapshot(watch.workId))?.context?.threadId === (watch.actualExecutionThreadId ?? watch.origin.threadId);
            if (watch.source === 'mcp')
                return mcp?.canObserve(watch) ?? false;
            if (watch.source === 'agent_group')
                return groups?.groupThread(watch.workId) === watch.origin.threadId;
            if (watch.source !== 'kswarm' || !ks)
                return false;
            const routing = await request(ks.url, `/projects/${encodeURIComponent(watch.workId)}/activity-identity`, { 'x-kswarm-mutation-token': ks.mutationToken });
            if (!routing.ok || routing.sourceDataEpoch !== watch.sourceDataEpoch || typeof routing.roomId !== 'string')
                return false;
            const room = await request(ks.brokerUrl, `/rooms/${encodeURIComponent(routing.roomId)}`, { 'x-intent-broker-room-token': ks.roomToken });
            return room.ok !== false && Boolean(room.room);
        }, stopWatch: watchId => { sources?.stopWatch(watchId); mcp?.activities.stopWatch(watchId); }, watchBound: async (watchId) => { await sources?.startWatch(watchId); const watch = host.store.getWatch(watchId); if (watch?.source === 'mcp')
            mcp.bound(watch); },
        sourceHint: (source, workId) => source === 'kswarm' ? sources.refreshProject(workId, true) : sources.refreshGroup(workId, true), onError: () => { } });
    sources = new ConversationActivitySources({ store: host.store, service: host.service,
        taskHost: () => tasks.host(), readProject: async (projectId, after, signal) => {
            if (!ks)
                throw new Error('activity_kswarm_unavailable');
            return request(ks.url, `/projects/${encodeURIComponent(projectId)}/activity?after=${after}&limit=200`, { 'x-kswarm-mutation-token': ks.mutationToken }, signal);
        }, ...(groups ? { readGroup: (groupId, after) => groups.events(groupId, after), groupMembers: (runId) => groups.members(runId) } : {}),
    });
    mcp = new ActivityOwnerMcp({ root: config.dataRoot, store: host.store, service: host.service, actorId: config.actorId });
    supervisor = new ActivitySourceSupervisor(config.dataRoot, host.ownerEpoch);
    let socket, reconnect, closed = false;
    const connect = () => {
        if (!ks || closed)
            return;
        socket = new WebSocket(`${ks.url.replace(/^http/, 'ws')}/ws`);
        socket.on('open', () => { void sources.projectConnectionChanged('connected'); });
        socket.on('message', data => {
            try {
                const hint = JSON.parse(data.toString());
                if (hint.type === 'project_activity' && typeof hint.projectId === 'string')
                    void sources.refreshProject(hint.projectId, true);
            }
            catch { /* Hints are not facts. */ }
        });
        socket.on('close', () => { if (closed)
            return; void sources.projectConnectionChanged('disconnected'); reconnect = setTimeout(connect, 1000); reconnect.unref(); });
        socket.on('error', () => socket?.close());
    };
    try {
        await host.start();
        for (const source of config.managedSources ?? [])
            await supervisor.ensure(source);
        for (const watch of host.store.listWatches())
            await sources.startWatch(watch.watchId);
        await mcp.restore();
        connect();
        ready = true;
    }
    catch (error) {
        await mcp.close();
        sources.dispose();
        tasks.close();
        groups?.close();
        identity.close();
        await host.stop();
        throw error;
    }
    return { host, supervisor, async stop() { closed = true; if (reconnect)
            clearTimeout(reconnect); socket?.close(); await mcp.close(); sources.dispose(); tasks.close(); groups?.close(); identity.close(); await host.stop(); } };
}
export async function serveConversationActivityOwner(configFile) {
    process.umask(0o077);
    const state = statSync(configFile);
    if (state.size > 256 * 1024 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0))
        throw new Error('activity_owner_config_not_private');
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    let runtime;
    let stopping = false;
    const stop = () => {
        if (stopping)
            return;
        stopping = true;
        void runtime.stop().then(() => process.exit(0), () => process.exit(1));
    };
    runtime = await startConversationActivityOwner(config, { idle: stop });
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
}
