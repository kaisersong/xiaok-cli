import { capturedGoalTaskKey } from './captured-goal-task-key.js';
import { profileKeys, profileRecord } from './captured-profile-relations.js';
/** Independent input catalogue. It never calls the relation projector. */
export class CapturedProfileSlots {
    targetDefinitions = new Map();
    targetKey(namespace, id, sourceId, path) { return JSON.stringify([namespace, id, sourceId, path]); }
    checkDefinitions(entries) { const observed = new Map(); for (const { identity, count } of entries) {
        if (identity.namespace !== 'goal-task-execution')
            continue;
        const key = this.targetKey(identity.namespace, identity.id, identity.sourceId, identity.path);
        if (observed.has(key) || this.targetDefinitions.get(key) !== count)
            throw Error('captured_profile_definition_slot');
        observed.set(key, count);
    } if (observed.size !== this.targetDefinitions.size)
        throw Error('captured_profile_definition_slot'); }
    expected = new Map();
    observed = new Map();
    key(kind, sourceId, path, namespace, id) { return JSON.stringify([kind, sourceId, path, namespace ?? null, id ?? null]); }
    add(kind, sourceId, path, namespace, id) { const key = this.key(kind, sourceId, path, namespace, id); this.expected.set(key, (this.expected.get(key) ?? 0) + 1); }
    ref(sourceId, path, namespace, id) { if (id !== undefined && id !== null)
        this.add('relation', sourceId, path, namespace, id); }
    gap(sourceId, path, value) { if (value !== undefined && value !== null)
        this.add('gap', sourceId, path); }
    start(sources) { for (const source of sources)
        this.ref(source.sourceId, 'source', 'profile-source', source.sourceId); }
    note(event) { if (!event.origin || !['relation', 'gap'].includes(event.kind))
        return; const key = this.key(event.kind, event.origin.sourceId, event.origin.path, event.namespace, event.id); const count = (this.observed.get(key) ?? 0) + 1; if (event.kind === 'relation' && count > (this.expected.get(key) ?? 0))
        throw Error('captured_profile_unregistered_slot:' + key); this.observed.set(key, count); }
    complete() { let count = 0; for (const [key, required] of this.expected) {
        if ((this.observed.get(key) ?? 0) < required)
            throw Error('captured_profile_unprojected_slot:' + key);
        count += required;
    } return count; }
    list(value) { if (!Array.isArray(value))
        throw Error('captured_profile_slot_shape'); return value; }
    each(value, fn) { this.list(value).forEach((v, i) => fn(profileRecord(v), i)); }
    session(value, s, p) { const r = profileRecord(value); this.ref(s, p + '.containerSessionId', 'session', r.containerSessionId); if (r.storedSessionIdentity === 'present')
        this.ref(s, p + '.storedSessionIdentity', 'session', r.containerSessionId);
    else
        this.gap(s, p + '.storedSessionIdentity', r.storedSessionIdentity); this.ref(s, p + '.forkReference', 'session', r.forkReference); this.list(r.lineageReferences).forEach((v, i) => this.ref(s, p + `.lineageReferences[${i}]`, 'session', v)); this.each(r.sessionReferences, (v, i) => this.ref(s, p + `.sessionReferences[${i}]`, 'session', v.sessionIdentity)); this.each(r.typedReferences, (v, i) => this.ref(s, p + `.typedReferences[${i}]`, String(v.namespace), v.identity)); for (const k of ['intentSubjects', 'observationReferences'])
        this.list(r[k]).forEach((v, i) => this.gap(s, p + `.${k}[${i}]`, v)); const pub = profileRecord(r.publicationDeclarations); for (const k of ['nativeContracts', 'candidates', 'verificationExecutions'])
        this.list(pub[k]).forEach((v, i) => this.gap(s, p + `.publicationDeclarations.${k}[${i}]`, v)); }
    task(value, s, p) { const r = profileRecord(value); this.ref(s, p + '.taskId', 'task', r.taskId); this.list(r.sessionIdentities).forEach((v, i) => this.ref(s, p + `.sessionIdentities[${i}]`, 'session', v)); this.each(r.references, (v, i) => this.ref(s, p + '.' + String(v.relation), String(v.namespace), v.id)); for (const k of ['contexts', 'multiAgentPreparations', 'protectedObservationClosures'])
        this.list(r[k]).forEach((v, i) => this.gap(s, p + `.${k}[${i}]`, v)); this.each(r.executionScopeDeclarations, (v) => { const scope = profileRecord(v.scope); if (scope.kind === 'goal_turn')
        this.ref(s, p + '.' + String(v.path), 'goal-task-execution', capturedGoalTaskKey(r.taskId, scope));
    else
        this.gap(s, p + '.' + String(v.path), v.scope); }); }
    goal(value, s, p) {
        const r = profileRecord(value);
        this.ref(s, p + '.containerSessionId', 'logical-goal-container', r.containerSessionId);
        for (const [k, n] of [['declaredGoalIds', 'goal'], ['declaredTaskIds', 'task']])
            this.list(r[k]).forEach((v, i) => this.ref(s, p + `.${k}[${i}]`, n, v));
        this.ref(s, p + '.forkedFromGoalId', 'goal', r.forkedFromGoalId);
        this.each(r.referencedOwners, (v, i) => { const at = p + `.referencedOwners[${i}]`; if (['task', 'goal', 'loop_stage', 'loop_run', 'project'].includes(String(v.ownerKind)))
            this.ref(s, at, String(v.ownerKind), v.ownerId);
        else
            this.gap(s, at, v); });
        this.each(r.goalAssociations, (association, i) => {
            const base = p + `.goalAssociations[${i}]`;
            this.ref(s, base + '.goalId', 'goal', association.goalId);
            this.ref(s, base + '.logicalContainerId', 'logical-goal-container', association.logicalContainerId);
            this.each(association.completionTasks, (task, j) => this.ref(s, base + `.completionTasks[${j}].taskId`, 'task', task.taskId));
            this.each(association.evidenceOwners, (evidence, j) => {
                const path = base + `.evidenceOwners[${j}]`;
                if (['task', 'goal', 'loop_stage', 'loop_run', 'project'].includes(String(evidence.ownerKind)))
                    this.ref(s, path + '.ownerId', String(evidence.ownerKind), evidence.ownerId);
                else
                    this.gap(s, path + '.ownerId', evidence);
                this.gap(s, path + '.uri', evidence.uri);
                this.gap(s, path + '.metadata', evidence.metadata);
            });
        });
        const pub = profileRecord(r.publication);
        for (const k of ['intents', 'attempts'])
            this.list(pub[k]).forEach((v, i) => this.gap(s, p + `.publication.${k}[${i}]`, v));
    }
    migration(value, s, p) { const r = profileRecord(value); for (const [k, n] of [['sessionId', 'session'], ['targetSessionId', 'session'], ['migrationId', 'migration']])
        this.ref(s, p + '.' + k, n, r[k]); this.gap(s, p + '.targetAuthorityId', r.targetAuthorityId); }
    obligation(value, s, p) { const r = profileRecord(value); for (const [k, n] of [['obligationId', 'goal-obligation'], ['predicateId', 'verification-predicate'], ['predicateVersion', 'verification-predicate-version']])
        this.ref(s, p + '.' + k, n, r[k]); this.gap(s, p, r); }
    registrationSource(value, s, p) { const r = profileRecord(value); this.gap(s, p, r); if (r.kind === 'migration') {
        this.ref(s, p + '.sourceSessionId', 'session', r.sourceSessionId);
        this.ref(s, p + '.migrationId', 'migration', r.migrationId);
    }
    else if (r.kind === 'new-owner' && r.fork !== undefined) {
        const fork = profileRecord(r.fork);
        this.ref(s, p + '.fork.sessionId', 'logical-goal-container', fork.sessionId);
        this.ref(s, p + '.fork.authorityId', 'verification-authority', fork.authorityId);
        this.gap(s, p + '.fork.owner', fork.owner);
        this.list(fork.dependencies).forEach((v, i) => this.gap(s, p + `.fork.dependencies[${i}]`, v));
        this.gap(s, p + '.fork', fork);
    } }
    nativeGoal(value, s, p) { const d = profileRecord(value); this.ref(s, p + '.sessionId', 'logical-goal-container', d.sessionId); this.each(d.records, (r, i) => { const b = p + `.records[${i}]`; for (const [k, n] of [['id', 'goal-native-mutation'], ['sessionId', 'logical-goal-container'], ['enrollmentRequestId', 'owner-enrollment-request'], ['applicationRequestId', 'goal-application-request']])
        this.ref(s, b + '.' + k, n, r[k]); const target = profileRecord(r.target); this.ref(s, b + '.target.goalId', 'goal', target.goalId); this.ref(s, b + '.target.sessionId', 'logical-goal-container', target.sessionId); this.gap(s, b + '.target', target); if (r.previous !== null) {
        const v = profileRecord(r.previous);
        this.ref(s, b + '.previous.goalId', 'goal', v.goalId);
        this.ref(s, b + '.previous.forkedFromGoalId', 'goal', v.forkedFromGoalId);
    } this.list(profileRecord(r.definition).obligations).forEach((v, j) => this.obligation(v, s, b + `.definition.obligations[${j}]`)); if (r.forkSource !== undefined) {
        const fork = profileRecord(r.forkSource), snapshot = profileRecord(fork.snapshot), source = profileRecord(snapshot.source), application = profileRecord(snapshot.application), registration = profileRecord(snapshot.registration);
        this.ref(s, b + '.forkSource.stateHash', 'goal-fork-state-hash', fork.stateHash);
        this.gap(s, b + '.forkSource.snapshot.source.owner', source.owner);
        this.ref(s, b + '.forkSource.snapshot.source.authorityId', 'verification-authority', source.authorityId);
        this.ref(s, b + '.forkSource.snapshot.source.sessionId', 'logical-goal-container', source.sessionId);
        this.list(source.dependencies).forEach((v, j) => this.gap(s, b + `.forkSource.snapshot.source.dependencies[${j}]`, v));
        this.ref(s, b + '.forkSource.snapshot.application.goalId', 'goal', application.goalId);
        this.ref(s, b + '.forkSource.snapshot.application.sessionId', 'logical-goal-container', application.sessionId);
        this.gap(s, b + '.forkSource.snapshot.application', application);
        this.registrationSource(registration.source, s, b + '.forkSource.snapshot.registration.source');
        this.each(registration.obligations, (v, j) => { this.obligation(v.obligation, s, b + `.forkSource.snapshot.registration.obligations[${j}].obligation`); this.gap(s, b + `.forkSource.snapshot.registration.obligations[${j}].recipe`, v.recipe); });
    } }); }
    fact(family, value) {
        const f = profileRecord(value);
        if (['loop', 'groups', 'artifact', 'kswarm'].includes(family)) {
            this.stream(family, f);
            return;
        }
        if (family === 'writer-lock')
            return;
        this.each(f.sources, (r) => {
            const s = String(r.sourceId);
            if (family === 'file' || family === 'session') {
                this.list(r.sessions).forEach((v, i) => this.session(v, s, `sessions[${i}]`));
                this.list(r.migrations).forEach((v, i) => this.migration(v, s, `migrations[${i}]`));
                this.ref(s, 'lastSessionReference', 'session', r.lastSessionReference);
            }
            if (family === 'file') {
                this.list(r.tasks).forEach((v, i) => this.task(v, s, `tasks[${i}]`));
                this.list(r.goals).forEach((v, i) => this.goal(v, s, `goals[${i}]`));
                this.list(r.nativeGoals).forEach((v, i) => this.nativeGoal(v, s, `nativeGoals[${i}]`));
                for (const k of ['deletions', 'aliases'])
                    this.list(r[k]).forEach((v, i) => this.gap(s, `${k}[${i}]`, v));
                this.list(r.activeTaskIds).forEach((v, i) => this.ref(s, `activeTaskIds[${i}]`, 'task', v));
                if (r.registry) {
                    const registry = profileRecord(r.registry);
                    this.each(registry.sources, (v, i) => { this.ref(s, `registry.sources[${i}].sourceId`, 'profile-source', v.sourceId); this.gap(s, `registry.sources[${i}]`, v); });
                    this.gap(s, 'registry', registry);
                }
                this.each(r.sourceReferences, (v, i) => { this.ref(s, String(v.path), 'profile-source', v.sourceId); this.list(v.sessionIdentities).forEach((id, j) => this.ref(s, String(v.path), 'session', id)); if (v.unresolved)
                    this.gap(s, String(v.path), v); });
            }
            if (family === 'goal') {
                this.each(r.taskBindings, (v, i) => { const path = `taskBindings[${i}]`, id = capturedGoalTaskKey(v.taskId, { kind: 'goal_turn', origin: v.origin, goalId: v.goalId, epoch: v.epoch, goalTurnId: v.goalTurnId, threadId: v.threadId }); this.ref(s, path, 'goal-task-execution', id); const key = this.targetKey('goal-task-execution', id, s, path); this.targetDefinitions.set(key, (this.targetDefinitions.get(key) ?? 0) + 1); });
                this.each(r.goals, (g, i) => { this.ref(s, `goals[${i}].goalId`, 'goal', g.goalId); this.goal(g.declaration, s, `goals[${i}].declaration`); this.ref(s, `goals[${i}].logicalContainerId`, 'logical-goal-container', g.logicalContainerId); });
                for (const key of ['pointers', 'taskBindings', 'contextTasks'])
                    this.each(r[key], (v, i) => { for (const [k, n] of [['goalId', 'goal'], ['currentGoalId', 'goal'], ['logicalContainerId', 'logical-goal-container'], ['taskId', 'task'], ['threadId', 'thread'], ['goalTurnId', 'goal-turn'], ['bindingId', 'goal-task-binding'], ['contextId', 'goal-context']])
                        this.ref(s, `${key}[${i}].${k}`, n, v[k]); });
            }
            if (family === 'codex') {
                this.each(r.nativeSessions, (v, i) => { this.ref(s, `nativeSessions[${i}].id`, 'codex-session', v.id); for (const [k, n] of [['nativeId', 'codex-external-thread'], ['owner', 'codex-owner']]) {
                    if (v[k])
                        this.ref(s, `nativeSessions[${i}].${k}`, n, v[k]);
                    else
                        this.gap(s, `nativeSessions[${i}].${k}`, { value: v[k] });
                } });
                this.each(r.threads, (v, i) => { this.ref(s, `threads[${i}].threadId`, 'thread', v.threadId); this.ref(s, `threads[${i}].nativeId`, 'codex-session', v.nativeId); });
                this.each(r.routes, (v, i) => { this.ref(s, `routes[${i}].taskId`, 'task', v.taskId); this.ref(s, `routes[${i}].threadId`, 'thread', v.threadId); });
            }
        });
        if (family === 'file') {
            this.each(f.aliases, (r, i) => { const s = String(r.canonicalSourceId), p = `aliases[${i}]`; this.ref(s, p + '.canonicalSourceId', 'profile-source', r.canonicalSourceId); if (r.marker)
                this.ref(s, p + '.marker.sourceId', 'profile-source', profileRecord(r.marker).sourceId); this.ref(s, p + '.binding.targetSessionId', 'session', profileRecord(r.binding).targetSessionId); this.gap(s, p + '.binding', r.binding); this.list(r.unresolvedReasons).forEach(v => this.gap(s, p + '.unresolvedReasons', v)); });
            this.each(f.observationSides, (r, i) => { const s = String(r.taskSourceId), p = `observationSides[${i}]`; this.ref(s, p + '.taskSourceId', 'profile-source', r.taskSourceId); if (r.sessionSourceId === null)
                this.gap(s, p + '.sessionSourceId', { sessionSourceId: null });
            else
                this.ref(s, p + '.sessionSourceId', 'profile-source', r.sessionSourceId); this.ref(s, p + '.sessionIdentity', 'session', r.sessionIdentity); this.list(r.taskIds).forEach((v, j) => this.ref(s, p + `.taskIds[${j}]`, 'task', v)); this.list(r.missingReasons).forEach(v => this.gap(s, p + '.missingReasons', v)); });
            this.each(f.historicalPointers, (r, i) => { this.ref(String(r.sourceId), `historicalPointers[${i}].sourceId`, 'profile-source', r.sourceId); this.ref(String(r.sourceId), `historicalPointers[${i}].sessionIdentity`, 'session', r.sessionIdentity); });
        }
        if (family === 'codex')
            this.each(f.pairs, (r, i) => { const s = String(r.routesSourceId), p = `pairs[${i}]`; this.ref(s, p, 'profile-source', r.routesSourceId); if (r.nativeSourceId)
                this.ref(s, p, 'profile-source', r.nativeSourceId);
            else
                this.gap(s, p, r.state); });
    }
    stream(family, e) {
        const kind = String(e.kind), wide = family === 'groups' || family === 'loop';
        const keys = {
            'source-start': ['kind', 'sourceId', 'snapshotHash', ...(family === 'groups' ? ['userVersion'] : wide ? [] : ['format'])],
            'table-start': ['kind', 'sourceId', 'table', 'columns'], 'table-end': ['kind', 'sourceId', 'table', 'count'],
            row: wide ? ['kind', 'sourceId', 'table', 'ordinal', 'rowid', 'cells', 'parsed', 'references', ...(family === 'groups' ? ['unmapped', 'observationDeclarations'] : ['embeddedTasks'])] : ['kind', 'sourceId', 'table', 'rowid', 'record', 'references', ...(family === 'artifact' ? ['parsedMetadata'] : [])],
            'source-end': wide ? ['kind', 'sourceId', 'snapshotHash', 'tables'] : ['kind', 'sourceId', 'counts'], complete: ['kind', 'sources', 'digest', ...(wide ? ['version'] : [])]
        };
        if (!keys[kind] || !wide && kind.startsWith('table-'))
            throw Error('captured_profile_stream_kind');
        profileKeys(e, keys[kind]);
        if (kind !== 'row')
            return;
        const s = String(e.sourceId), p = `${String(e.table)}[${String(e.rowid)}]`;
        this.each(e.references, (r, i) => { if (wide)
            this.ref(s, p + `.references[${i}]`, String(r.namespace), r.id);
        else {
            const cell = profileRecord(r.value);
            if (r.referenceState === 'declared' && cell.type === 'text')
                this.ref(s, p + `.references[${i}]`, String(r.domain), cell.value);
            else
                this.gap(s, p + `.references[${i}]`, r);
        } });
        if (family === 'groups') {
            this.list(e.unmapped).forEach(v => this.gap(s, p + '.' + String(v), v));
            this.each(e.observationDeclarations, (v) => { profileKeys(v, ['path', 'reference']); if (typeof v.path !== 'string' || !v.path)
                throw Error('captured_profile_observation_path'); this.gap(s, p + '.' + v.path, v.reference); });
        }
        if (family === 'loop')
            this.each(e.embeddedTasks, (r, i) => { this.task(r.declaration, s, p + `.embeddedTasks[${i}].declaration`); this.gap(s, p + `.embeddedTasks[${i}].completionObservation`, r.completionObservation); });
        if (family === 'artifact' && e.parsedMetadata !== null)
            this.gap(s, p + '.parsedMetadata', e.parsedMetadata);
        if (family === 'kswarm' && profileRecord(e.record).state_json)
            this.gap(s, p + '.state_json', true);
    }
}
