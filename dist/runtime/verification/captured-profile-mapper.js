import { capturedGoalTaskKey } from './captured-goal-task-key.js';
import { CapturedProfileSlots } from './captured-profile-slots.js';
import { createHash } from 'node:crypto';
import { checkProfileSourceCapture, readProfileSourceCapture, readProfileSqliteSchema } from './profile-source-capture.js';
import { readCapturedFileSources } from './captured-file-sources.js';
import { readCapturedSQLiteSessionSources } from './captured-sqlite-sessions.js';
import { readCapturedSQLiteGoalSources } from './captured-sqlite-goals.js';
import { readCapturedSQLiteCodexSources } from './captured-sqlite-codex.js';
import { iterateCapturedSQLiteLoopSources } from './captured-sqlite-loops.js';
import { iterateCapturedSQLiteGroupsSources } from './captured-sqlite-groups.js';
import { iterateCapturedSQLiteArtifactWorkspaceSources } from './captured-sqlite-artifact-workspace.js';
import { iterateCapturedSQLiteKSwarmStateSources } from './captured-sqlite-kswarm.js';
import { freezeCapturedData } from './captured-source-json.js';
import { CapturedProfileRelations, profileRecord, profileKeys } from './captured-profile-relations.js';
const SQLITE_FAMILIES = Object.freeze({ 'session-sqlite-v1': 'session', 'goal-sqlite-v1': 'goal', 'codex-native-sqlite-v1': 'codex', 'codex-routes-sqlite-v1': 'codex', 'loop-sqlite-v1': 'loop', 'multi-agent-groups-sqlite-v1': 'groups', 'artifact-workspace-sqlite-v1': 'artifact', 'kswarm-state-sqlite-v1': 'kswarm', 'writer-lock-sqlite-v1': 'writer-lock' });
function fail() { throw Error('captured_profile_population'); }
function rows(value) { if (!Array.isArray(value))
    fail(); return value; }
function string(value) { if (typeof value !== 'string' || !value)
    fail(); return value; }
/** Complete statements of the supplied capture only; never a native owner/cap. */
export async function* iterateCapturedProfileDeclarations(owner, token) {
    await checkProfileSourceCapture(owner, token);
    const capture = readProfileSourceCapture(owner, token), summaries = capture.sources.map(({ source, snapshotHash }) => { const family = source.kind === 'sqlite-db' ? SQLITE_FAMILIES[source.snapshotFormat] : ['session-root', 'task-root', 'goal-file-root', 'profile-registry', 'session-alias-holder'].includes(source.kind) ? 'file' : undefined; if (!family)
        fail(); return { sourceId: source.sourceId, snapshotHash, family }; }).sort((a, b) => Buffer.compare(Buffer.from(a.sourceId), Buffer.from(b.sourceId)));
    const original = new Map(summaries.map(s => [s.sourceId, s])), seen = new Set(), relations = new CapturedProfileRelations(), slots = new CapturedProfileSlots(), hash = createHash('sha256').update('xiaok-captured-profile-declarations-v1\0');
    let relationCount = 0, gapCount = 0;
    if (original.size !== summaries.length)
        fail();
    for (const s of summaries)
        relations.define('profile-source', s.sourceId, { sourceId: s.sourceId, path: 'source' });
    async function check() { await checkProfileSourceCapture(owner, token); if (readProfileSourceCapture(owner, token) !== capture)
        fail(); }
    async function frame(event) { await check(); if (event.kind === 'capture-start')
        slots.start(event.sources); if (event.kind === 'family-fact')
        slots.fact(event.family, event.fact); slots.note(event); const frozen = freezeCapturedData(event); const bytes = Buffer.from(JSON.stringify(frozen)); hash.update(String(bytes.length)).update('\0').update(bytes); if (event.kind === 'relation')
        relationCount++; if (event.kind === 'gap')
        gapCount++; return frozen; }
    function completed(sourceId, snapshotHash, family) { const id = string(sourceId), entry = original.get(id); if (!entry || entry.family !== family || entry.snapshotHash !== snapshotHash || seen.has(id))
        fail(); seen.add(id); }
    yield await frame({ kind: 'capture-start', sources: summaries });
    await check();
    for (const family of ['file', 'session', 'goal', 'codex', 'loop', 'groups', 'artifact', 'kswarm', 'writer-lock']) {
        const expected = summaries.filter(s => s.family === family);
        if (!expected.length)
            continue;
        if (family === 'file') {
            const facts = readCapturedFileSources(owner, token);
            profileKeys(facts, ['kind', 'sources', 'aliases', 'observationSides', 'historicalPointers']);
            for (const source of facts.sources) {
                profileKeys(source, ['sourceId', 'snapshotHash', 'kind', 'directory', 'entries', 'sessions', 'migrations', 'deletions', 'tasks', 'goals', 'nativeGoals', 'aliases', 'activeTaskIds', 'lastSessionReference', 'registry', 'sourceReferences']);
                const id = source.sourceId, at = (path) => ({ sourceId: id, path });
                source.sessions.forEach((d, i) => relations.session(d, id, `sessions[${i}]`));
                source.tasks.forEach((d, i) => relations.task(d, id, `tasks[${i}]`));
                source.goals.forEach((d, i) => relations.goal(d, id, `goals[${i}]`));
                source.nativeGoals.forEach((d, i) => relations.nativeGoal(d, id, `nativeGoals[${i}]`));
                source.migrations.forEach((d, i) => relations.migration(d, id, `migrations[${i}]`));
                source.deletions.forEach((d, i) => relations.complex(d, at(`deletions[${i}]`)));
                source.aliases.forEach((d, i) => relations.complex(d, at(`aliases[${i}]`)));
                source.activeTaskIds.forEach((task, i) => relations.ref('task', task, at(`activeTaskIds[${i}]`), { exactSource: id }));
                relations.ref('session', source.lastSessionReference, at('lastSessionReference'), { exactSource: id });
                if (source.registry) {
                    source.registry.sources.forEach((entry, i) => { relations.ref('profile-source', entry.sourceId, at(`registry.sources[${i}].sourceId`), { scope: entry }); relations.complex(entry, at(`registry.sources[${i}]`)); });
                    relations.complex(source.registry, at('registry'));
                    if (source.registry.legacyInventoryRequired)
                        relations.gap('legacy-inventory-required', at('registry'));
                }
                source.sourceReferences.forEach((r, i) => { profileKeys(r, ['path', 'sourceId', 'sessionIdentities', 'unresolved']); const path = string(r.path); relations.ref('profile-source', r.sourceId, at(path), { exactSource: r.sourceId, scope: { path: r.path, referenceField: 'sourceId' } }); r.sessionIdentities.forEach((session, j) => relations.ref('session', session, at(path), { exactSource: id, scope: { sourcePath: r.path, writerSourceId: r.sourceId, referenceField: 'sessionIdentities', identityIndex: j } })); if (r.unresolved)
                    relations.gap('unresolved', at(path), r); });
                completed(id, source.snapshotHash, family);
            }
            facts.aliases.forEach((r, i) => { const at = (path) => ({ sourceId: r.canonicalSourceId, path: `aliases[${i}].${path}` }); relations.ref('profile-source', r.canonicalSourceId, at('canonicalSourceId'), { exactSource: r.canonicalSourceId }); if (r.marker)
                relations.ref('profile-source', r.marker.sourceId, at('marker.sourceId'), { exactSource: r.marker.sourceId, scope: { path: r.marker.path } }); relations.ref('session', r.binding.targetSessionId, at('binding.targetSessionId'), { exactSource: r.canonicalSourceId, exactPhysical: r.state === 'active' && r.marker !== null && r.target === 'present', scope: r.binding }); relations.complex(r.binding, at('binding')); r.unresolvedReasons.forEach(reason => relations.gap(reason, at('unresolvedReasons'))); });
            facts.observationSides.forEach((r, i) => { const at = (path) => ({ sourceId: r.taskSourceId, path: `observationSides[${i}].${path}` }); relations.ref('profile-source', r.taskSourceId, at('taskSourceId'), { exactSource: r.taskSourceId }); if (r.sessionSourceId)
                relations.ref('profile-source', r.sessionSourceId, at('sessionSourceId'), { exactSource: r.sessionSourceId });
            else
                relations.gap('session-source-absent', at('sessionSourceId'), { sessionSourceId: r.sessionSourceId }); relations.ref('session', r.sessionIdentity, at('sessionIdentity'), { ...(r.sessionSourceId ? { exactSource: r.sessionSourceId } : {}), scope: r }); r.taskIds.forEach((task, j) => relations.ref('task', task, at(`taskIds[${j}]`), { exactSource: r.taskSourceId })); r.missingReasons.forEach(reason => relations.gap(reason, at('missingReasons'))); });
            facts.historicalPointers.forEach((r, i) => { relations.ref('profile-source', r.sourceId, { sourceId: r.sourceId, path: `historicalPointers[${i}].sourceId` }, { exactSource: r.sourceId }); relations.ref('session', r.sessionIdentity, { sourceId: r.sourceId, path: `historicalPointers[${i}].sessionIdentity` }, { exactSource: r.sourceId }); });
            yield await frame({ kind: 'family-fact', family, fact: facts });
            await check();
        }
        else if (family === 'session') {
            const facts = readCapturedSQLiteSessionSources(owner, token);
            profileKeys(facts, ['kind', 'sources']);
            for (const s of facts.sources) {
                profileKeys(s, ['sourceId', 'snapshotHash', 'sessions', 'migrations', 'lastSessionReference']);
                s.sessions.forEach((d, i) => relations.session(d, s.sourceId, `sessions[${i}]`));
                s.migrations.forEach((d, i) => relations.migration(d, s.sourceId, `migrations[${i}]`));
                relations.ref('session', s.lastSessionReference, { sourceId: s.sourceId, path: 'lastSessionReference' }, { exactSource: s.sourceId });
                completed(s.sourceId, s.snapshotHash, family);
            }
            yield await frame({ kind: 'family-fact', family, fact: facts });
            await check();
        }
        else if (family === 'goal') {
            const facts = readCapturedSQLiteGoalSources(owner, token);
            profileKeys(facts, ['kind', 'sources']);
            for (const s of facts.sources) {
                profileKeys(s, ['sourceId', 'snapshotHash', 'goals', 'pointers', 'taskBindings', 'contextTasks']);
                s.goals.forEach((g, i) => { profileKeys(g, ['goalId', 'logicalContainerId', 'revision', 'epoch', 'declaration']); relations.ref('goal', g.goalId, { sourceId: s.sourceId, path: `goals[${i}].goalId` }, { scope: { epoch: g.epoch, revision: g.revision } }); relations.goal(g.declaration, s.sourceId, `goals[${i}].declaration`); relations.ref('logical-goal-container', g.logicalContainerId, { sourceId: s.sourceId, path: `goals[${i}].logicalContainerId` }); });
                s.taskBindings.forEach((binding, i) => relations.define('goal-task-execution', capturedGoalTaskKey(binding.taskId, { kind: 'goal_turn', origin: binding.origin, goalId: binding.goalId, epoch: binding.epoch, goalTurnId: binding.goalTurnId, threadId: binding.threadId }), { sourceId: s.sourceId, path: `taskBindings[${i}]` }, { binding }));
                for (const key of ['pointers', 'taskBindings', 'contextTasks'])
                    s[key].forEach((v, i) => { const r = profileRecord(v), at = (field) => ({ sourceId: s.sourceId, path: `${key}[${i}].${field}` }); for (const [field, namespace] of [['goalId', 'goal'], ['currentGoalId', 'goal'], ['logicalContainerId', 'logical-goal-container'], ['taskId', 'task'], ['threadId', 'thread'], ['goalTurnId', 'goal-turn'], ['bindingId', 'goal-task-binding'], ['contextId', 'goal-context']])
                        relations.ref(namespace, r[field], at(field), { scope: r }); });
                completed(s.sourceId, s.snapshotHash, family);
            }
            yield await frame({ kind: 'family-fact', family, fact: facts });
            await check();
        }
        else if (family === 'codex') {
            const facts = readCapturedSQLiteCodexSources(owner, token);
            profileKeys(facts, ['kind', 'sources', 'pairs']);
            for (const s of facts.sources) {
                profileKeys(s, ['sourceId', 'snapshotHash', 'nativeSessions', 'settings', 'threads', 'routes']);
                s.nativeSessions.forEach((r, i) => { const origin = { sourceId: s.sourceId, path: `nativeSessions[${i}]` }; relations.define('codex-session', r.id, { ...origin, path: origin.path + '.id' }); if (r.nativeId)
                    relations.ref('codex-external-thread', r.nativeId, { ...origin, path: origin.path + '.nativeId' }, { external: true });
                else
                    relations.complex({ value: r.nativeId }, { ...origin, path: origin.path + '.nativeId' }); if (r.owner)
                    relations.ref('codex-owner', r.owner, { ...origin, path: origin.path + '.owner' }, { external: true });
                else
                    relations.complex({ value: r.owner }, { ...origin, path: origin.path + '.owner' }); });
                s.threads.forEach((r, i) => { relations.define('thread', r.threadId, { sourceId: s.sourceId, path: `threads[${i}].threadId` }); relations.ref('codex-session', r.nativeId, { sourceId: s.sourceId, path: `threads[${i}].nativeId` }); });
                s.routes.forEach((r, i) => { relations.ref('task', r.taskId, { sourceId: s.sourceId, path: `routes[${i}].taskId` }); relations.ref('thread', r.threadId, { sourceId: s.sourceId, path: `routes[${i}].threadId` }, { exactSource: s.sourceId }); });
                completed(s.sourceId, s.snapshotHash, family);
            }
            facts.pairs.forEach((r, i) => { const origin = { sourceId: r.routesSourceId, path: `pairs[${i}]` }; relations.ref('profile-source', r.routesSourceId, origin, { exactSource: r.routesSourceId }); if (r.nativeSourceId)
                relations.ref('profile-source', r.nativeSourceId, origin, { exactSource: r.nativeSourceId });
            else
                relations.gap(r.state, origin); });
            yield await frame({ kind: 'family-fact', family, fact: facts });
            await check();
        }
        else if (family === 'writer-lock') {
            for (const s of expected) {
                if (readProfileSqliteSchema(owner, token, s.sourceId).length)
                    throw Error('captured_profile_writer_lock_schema');
                completed(s.sourceId, s.snapshotHash, family);
                yield await frame({ kind: 'family-fact', family, fact: { sourceId: s.sourceId, snapshotHash: s.snapshotHash, emptySchema: true } });
                await check();
            }
        }
        else {
            const iterator = family === 'loop' ? iterateCapturedSQLiteLoopSources(owner, token) : family === 'groups' ? iterateCapturedSQLiteGroupsSources(owner, token) : family === 'artifact' ? iterateCapturedSQLiteArtifactWorkspaceSources(owner, token) : iterateCapturedSQLiteKSwarmStateSources(owner, token);
            const started = new Set(), ended = new Set();
            let complete = false;
            try {
                for (const raw of iterator) {
                    const event = profileRecord(raw), kind = event.kind;
                    if (complete)
                        fail();
                    if (kind === 'complete') {
                        for (const v of rows(event.sources)) {
                            const s = profileRecord(v);
                            if (!ended.has(string(s.sourceId)))
                                fail();
                            completed(s.sourceId, s.snapshotHash, family);
                        }
                        if (ended.size !== expected.length)
                            fail();
                        complete = true;
                    }
                    else {
                        const sourceId = string(event.sourceId), entry = original.get(sourceId);
                        if (!entry || entry.family !== family)
                            fail();
                        if (kind === 'source-start') {
                            if (started.has(sourceId) || event.snapshotHash !== entry.snapshotHash)
                                fail();
                            started.add(sourceId);
                        }
                        else if (!started.has(sourceId) || ended.has(sourceId))
                            fail();
                        if (kind === 'source-end')
                            ended.add(sourceId);
                        if (kind === 'row') {
                            const base = `${string(event.table)}[${string(event.rowid)}]`, at = (path) => ({ sourceId, path: base + '.' + path });
                            if (family === 'groups' || family === 'loop') {
                                rows(event.references).forEach((v, i) => { const r = profileRecord(v); relations.ref(string(r.namespace), r.id, at(`references[${i}]`), { scope: r }); });
                                if (family === 'groups') {
                                    rows(event.unmapped).forEach((path) => relations.gap('unmapped', at(string(path))));
                                    rows(event.observationDeclarations).forEach((v) => { const declaration = profileRecord(v); profileKeys(declaration, ['path', 'reference']); relations.complex(declaration.reference, at(string(declaration.path))); });
                                }
                                else
                                    rows(event.embeddedTasks).forEach((v, i) => { const task = profileRecord(v); relations.task(task.declaration, sourceId, base + `.embeddedTasks[${i}].declaration`); relations.complex(task.completionObservation, at(`embeddedTasks[${i}].completionObservation`)); });
                            }
                            else {
                                rows(event.references).forEach((v, i) => { const r = profileRecord(v), cell = profileRecord(r.value); if (r.referenceState === 'declared' && cell.type === 'text')
                                    relations.ref(string(r.domain), cell.value, at(`references[${i}]`), { scope: r });
                                else
                                    relations.complex(r, at(`references[${i}]`)); });
                                if (family === 'artifact') {
                                    const metadata = event.parsedMetadata;
                                    if (metadata !== null)
                                        relations.gap('unsupported-semantic', at('parsedMetadata'), metadata);
                                }
                                else if (profileRecord(event.record).state_json)
                                    relations.gap('unsupported-semantic', at('state_json'));
                            }
                        }
                    }
                    yield await frame({ kind: 'family-fact', family, fact: raw });
                    await check();
                    for (const gap of relations.takeGaps()) {
                        yield await frame(gap);
                        await check();
                    }
                }
                if (!complete)
                    fail();
            }
            finally {
                iterator.return();
            }
        }
        if (expected.some(s => !seen.has(s.sourceId)))
            fail();
        for (const gap of relations.takeGaps()) {
            yield await frame(gap);
            await check();
        }
    }
    if (seen.size !== original.size)
        fail();
    slots.checkDefinitions(relations.definitionOccurrences());
    for (const event of relations.finish()) {
        yield await frame(event);
        await check();
    }
    const occurrenceCount = relations.completeOccurrences(), verifiedInputSlots = slots.complete();
    await check();
    yield freezeCapturedData({ kind: 'complete', enumerationComplete: true, sources: summaries, digest: hash.digest('hex'), relationCount, gapCount, occurrenceCount, verifiedInputSlots });
    await check();
}
