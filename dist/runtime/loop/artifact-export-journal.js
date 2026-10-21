import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { types } from 'node:util';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parsePublishedArtifactSelection } from '../verification/published-artifact-selection.js';
import { captureExecutionValue, executionFields as fields, executionIdentity as identifier } from './verification-execution.js';
import { freezeLoopPublicationValue } from './publication-config.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const progress = ['prepared', 'created', 'staged', 'committing'];
function fail() { throw Error('loop_export_journal_input'); }
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min)
    fail(); }
function digest(value) { if (typeof value !== 'string' || !sha.test(value))
    fail(); }
function exportId(value) { if (typeof value !== 'string' || !uuid.test(value))
    fail(); }
function fileIdentity(value) {
    fields(value, ['device', 'inode']);
    for (const part of [value.device, value.inode])
        if (typeof part !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(part) || BigInt(part) > 18446744073709551615n)
            fail();
}
function same(a, b) { return json(a) === json(b); }
function capture(raw) {
    // Detect a Proxy before any reflective operation can execute its traps.
    const seen = new WeakSet();
    let nodes = 0;
    function check(value, depth) {
        if (++nodes > 200000 || depth > 64)
            fail();
        if (!value || typeof value !== 'object')
            return;
        if (types.isProxy(value) || seen.has(value))
            fail();
        seen.add(value);
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if (!('value' in descriptor))
                fail();
            check(descriptor.value, depth + 1);
        }
    }
    check(raw, 0);
    return captureExecutionValue(raw);
}
export function parseLoopArtifactExportPreparation(raw) {
    const p = capture(raw);
    fields(p, ['id', 'requestSource', 'source', 'destination', 'now']);
    exportId(p.id);
    if (p.requestSource !== 'user')
        throw Error('loop_export_journal_source');
    integer(p.now);
    const s = p.source;
    fields(s, ['loopId', 'runId', 'candidateId', 'candidateRevision', 'payloadHash', 'vectorHash', 'descriptor']);
    for (const v of [s.loopId, s.runId, s.candidateId])
        identifier(v);
    integer(s.candidateRevision, 1);
    digest(s.payloadHash);
    digest(s.vectorHash);
    fields(s.descriptor, ['selection', 'sha256', 'size']);
    s.descriptor.selection = parsePublishedArtifactSelection(s.descriptor.selection);
    digest(s.descriptor.sha256);
    integer(s.descriptor.size);
    if (s.descriptor.size > 16 * 1024 ** 2)
        fail();
    const d = p.destination;
    fields(d, ['parent', 'parentIdentity', 'temporaryName', 'targetName', 'ownershipToken']);
    fileIdentity(d.parentIdentity);
    digest(d.ownershipToken);
    if (typeof d.parent !== 'string' || !isAbsolute(d.parent) || d.parent.includes('\0') || typeof d.targetName !== 'string' || !d.targetName || ['.', '..'].includes(d.targetName) || d.targetName.includes('\0') || basename(d.targetName) !== d.targetName || d.temporaryName !== '.xiaok-export-' + p.id || d.targetName === d.temporaryName)
        fail();
    return p;
}
function event(raw) {
    const e = capture(raw);
    if (!e || typeof e !== 'object')
        fail();
    switch (e.kind) {
        case 'created':
        case 'recovered':
            fields(e, ['kind', 'fileIdentity']);
            fileIdentity(e.fileIdentity);
            break;
        case 'staged':
            fields(e, ['kind', 'fileIdentity', 'sha256', 'size']);
            fileIdentity(e.fileIdentity);
            digest(e.sha256);
            integer(e.size);
            if (e.size > 16 * 1024 ** 2)
                fail();
            break;
        case 'committing':
        case 'interrupted':
            fields(e, ['kind']);
            break;
        case 'settled':
            fields(e, ['kind', 'outcome']);
            break;
        default: fail();
    }
    return e;
}
function outcome(value, p, recovered) {
    fields(value, ['status', 'committed', 'cleanup', 'error']);
    if (!['none', 'removed', 'unknown'].includes(value.cleanup))
        fail();
    if (value.status === 'completed') {
        if (p !== 'committing' || value.committed !== true || value.cleanup !== 'removed' || value.error !== null || recovered)
            fail();
        return;
    }
    if (typeof value.error !== 'string' || !value.error || Buffer.byteLength(value.error) > 4096)
        fail();
    if (value.status === 'failed') {
        if (typeof value.committed !== 'boolean' || value.committed && p !== 'committing' || value.cleanup === 'none' && (p !== 'prepared' || value.committed))
            fail();
    }
    else if (value.status === 'unknown') {
        if (value.committed !== null || value.cleanup !== (recovered ? 'removed' : 'unknown'))
            fail();
    }
    else
        fail();
    if (recovered && value.cleanup !== 'removed')
        fail();
}
export function parseLoopArtifactExportRecord(raw) {
    const r = capture(raw);
    fields(r, ['id', 'requestSource', 'source', 'destination', 'sequence', 'revision', 'createdAt', 'updatedAt', 'progress', 'state', 'fileIdentity', 'outcome', 'lastEvent']);
    parseLoopArtifactExportPreparation({ id: r.id, requestSource: r.requestSource, source: r.source, destination: r.destination, now: r.createdAt });
    integer(r.sequence, 1);
    integer(r.revision, 1);
    integer(r.updatedAt, r.createdAt);
    const index = progress.indexOf(r.progress);
    if (index < 0 || (r.progress === 'prepared') !== (r.fileIdentity === null))
        fail();
    if (r.fileIdentity !== null)
        fileIdentity(r.fileIdentity);
    const e = r.lastEvent === null ? null : event(r.lastEvent);
    if (r.outcome === null) {
        if (r.state !== 'pending' || r.revision !== index + 1 || (index === 0 ? e !== null : e?.kind !== r.progress))
            fail();
    }
    else {
        const recovered = e?.kind === 'recovered';
        outcome(r.outcome, r.progress, recovered);
        if (r.state !== (r.outcome.cleanup === 'unknown' ? 'unknown' : 'settled') || r.revision !== index + 2 + (recovered ? 1 : 0))
            fail();
        if (e?.kind === 'settled') {
            if (!same(e.outcome, r.outcome))
                fail();
        }
        else if (e?.kind === 'interrupted') {
            if (!same(r.outcome, { status: 'unknown', committed: null, cleanup: 'unknown', error: 'artifact_export_interrupted' }))
                fail();
        }
        else if (!recovered || r.fileIdentity === null)
            fail();
    }
    if (e?.kind === 'created' || e?.kind === 'staged' || e?.kind === 'recovered')
        if (!same(e.fileIdentity, r.fileIdentity))
            fail();
    if (e?.kind === 'staged' && (e.sha256 !== r.source.descriptor.sha256 || e.size !== r.source.descriptor.size))
        fail();
    return freezeLoopPublicationValue(r);
}
export function createLoopArtifactExportRecord(p, sequence) {
    return parseLoopArtifactExportRecord({ id: p.id, requestSource: 'user', source: p.source, destination: p.destination, sequence, revision: 1, createdAt: p.now, updatedAt: p.now, progress: 'prepared', state: 'pending', fileIdentity: null, outcome: null, lastEvent: null });
}
export function parseLoopArtifactExportUpdate(raw) {
    const u = capture(raw);
    fields(u, ['id', 'expectedRevision', 'event', 'requestSource', 'now']);
    exportId(u.id);
    integer(u.expectedRevision, 1);
    integer(u.now);
    if (u.requestSource !== 'user')
        throw Error('loop_export_journal_source');
    u.event = event(u.event);
    return u;
}
export function advanceLoopArtifactExport(old, u) {
    if (old.id !== u.id)
        fail();
    if (old.revision === u.expectedRevision + 1 && old.updatedAt === u.now && same(old.lastEvent, u.event))
        return old;
    if (old.revision !== u.expectedRevision || u.now < old.updatedAt)
        throw Error('loop_export_journal_conflict');
    const r = capture(old), e = u.event;
    if (e.kind === 'recovered') {
        if (r.state !== 'unknown' || !r.outcome || r.fileIdentity === null || !same(e.fileIdentity, r.fileIdentity))
            fail();
        r.outcome = { ...r.outcome, cleanup: 'removed' };
        r.state = 'settled';
    }
    else {
        if (r.state !== 'pending')
            throw Error('loop_export_journal_terminal');
        switch (e.kind) {
            case 'created':
                if (r.progress !== 'prepared')
                    fail();
                r.fileIdentity = capture(e.fileIdentity);
                r.progress = 'created';
                break;
            case 'staged':
                if (r.progress !== 'created' || !same(e.fileIdentity, r.fileIdentity) || e.sha256 !== r.source.descriptor.sha256 || e.size !== r.source.descriptor.size)
                    fail();
                r.progress = 'staged';
                break;
            case 'committing':
                if (r.progress !== 'staged')
                    fail();
                r.progress = 'committing';
                break;
            case 'settled':
                outcome(e.outcome, r.progress, false);
                r.outcome = capture(e.outcome);
                r.state = e.outcome.cleanup === 'unknown' ? 'unknown' : 'settled';
                break;
            case 'interrupted':
                r.outcome = { status: 'unknown', committed: null, cleanup: 'unknown', error: 'artifact_export_interrupted' };
                r.state = 'unknown';
                break;
        }
    }
    r.revision++;
    r.updatedAt = u.now;
    r.lastEvent = capture(e);
    return parseLoopArtifactExportRecord(r);
}
/** Pure crash classification for the private lifecycle owner. This preserves
 * the historical user request; it does not fabricate a new user update, grant
 * an installed writer, perform cleanup, or authorize replay of C/W/K. */
export function interruptPendingLoopArtifactExport(raw, now) {
    const old = parseLoopArtifactExportRecord(raw);
    integer(now, old.updatedAt);
    if (old.state !== 'pending')
        return old;
    return parseLoopArtifactExportRecord({ ...old, revision: old.revision + 1, updatedAt: now, state: 'unknown',
        outcome: { status: 'unknown', committed: null, cleanup: 'unknown', error: 'artifact_export_interrupted' }, lastEvent: { kind: 'interrupted' } });
}
export function loopArtifactExportHash(encoded) { return createHash('sha256').update('xiaok-loop-artifact-export-v1\0').update(encoded).digest('hex'); }
export function readLoopArtifactExportRow(row) {
    if (typeof row.record_json !== 'string' || loopArtifactExportHash(row.record_json) !== row.record_hash)
        throw Error('loop_export_journal_corrupt');
    const r = parseLoopArtifactExportRecord(JSON.parse(row.record_json));
    if (json(r) !== row.record_json || r.id !== row.id || r.sequence !== row.sequence || r.revision !== row.revision || r.destination.parentIdentity.device !== row.parent_device || r.destination.parentIdentity.inode !== row.parent_inode || r.destination.temporaryName !== row.temporary_name)
        throw Error('loop_export_journal_corrupt');
    return r;
}
