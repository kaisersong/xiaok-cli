// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeGithubObject, decodeGithubPage, matchGithubCreation, compareGithubRepresentations } from '../../electron/dsh-github-read-data.js';

const bound = { repositoryId: '123', nodeId: 'R_123', owner: 'octo', repo: 'demo' };
const parent = { repositoryId: '123', issueId: '900', nodeId: 'I_900', number: 7, isPullRequest: false };
const at = '2026-11-06T00:00:00Z';
const author = { id: 12, node_id: 'U_12', login: 'writer', avatar_url: 'https://ignored.test/a' };
const issue = (patch: Record<string, unknown> = {}) => ({ id: 900, node_id: 'I_900', number: 7, title: 'Please draft', body: 'a bounded draft', user: author, created_at: at, updated_at: at, labels: [{ id: 55, node_id: 'L_55', name: 'allowed', color: 'ffffff' }], state: 'open', locked: false, repository_url: 'https://api.github.com/repos/octo/demo', html_url: 'https://github.com/octo/demo/issues/7', ...patch });
const comment = (patch: Record<string, unknown> = {}) => ({ id: 44, node_id: 'C_44', body: 'please add this', user: author, created_at: at, updated_at: at, issue_url: 'https://api.github.com/repos/octo/demo/issues/7', html_url: 'https://github.com/octo/demo/issues/7#issuecomment-44', ...patch });
const object = (raw: unknown = issue(), kind: 'issue'|'comment' = 'issue', tag = 'etag:one') => {
  const result = decodeGithubObject({ schemaVersion: 1, kind, raw, boundRepository: bound, parentIssue: kind === 'comment' ? parent : null, representationTag: tag });
  if (result.kind !== 'value') throw Error('fixture must decode'); return result.value;
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const page = (kind: string, value: unknown, parentIssue: unknown = null) => decodeGithubPage({ schemaVersion: 1, kind, bytes: bytes(value), maxBytes: 1024 * 1024, boundRepository: kind === 'user' ? null : bound, parentIssue, representationTag: ['issues', 'issue', 'issue_comments', 'comment', 'events'].includes(kind) ? 'etag:one' : null });
const event = (kind: 'issue'|'comment' = 'issue', patch: Record<string, unknown> = {}) => {
  const raw = { id: '800', type: kind === 'issue' ? 'IssuesEvent' : 'IssueCommentEvent', actor: { id: 12, login: 'writer' }, repo: { id: 123, name: 'octo/demo' }, created_at: at, payload: kind === 'issue' ? { action: 'opened', issue: issue() } : { action: 'created', issue: issue(), comment: comment() }, public: false, ...patch };
  const decoded = page('events', [raw]);
  if (!('entries' in decoded) || decoded.entries[0]?.kind !== 'value') throw Error('event fixture must decode');
  return decoded.entries[0].value;
};
const context = () => ({ schemaVersion: 1, boundRepository: bound, parentIssue: parent, selector: { kind: 'issue_ids', issueIds: ['900'] }, window: { effectiveAt: '2026-11-05T00:00:00Z', observationsEndAt: '2026-11-07T00:00:00Z', sourceSnapshotAt: '2026-11-06T00:01:00Z' }, currentRepresentationTag: 'etag:one', currentFreshness: 'current', pagination: 'complete' });

describe('G03/G04 bounded complete-byte GitHub decoding', () => {
  it('projects real provider extra fields while preserving canonical stable IDs and nulls', () => {
    const result = object();
    expect(result.objectId).toBe('900'); expect(result.issueNumber).toBe(7); expect(result.nodeId).toBe('I_900');
    expect(result.authorId).toBe('12'); expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('html_url'); expect(result.completeness).toBe('complete');
    expect(Object.isFrozen(result.labelIds)).toBe(true);
    expect(object({ ...issue(), irrelevant: { extra: [1, 2, 3] } })).toEqual(result);
  });
  it('retains PR exclusions and invalid objects in list positions rather than washing them away', () => {
    const result = page('issues', [issue(), issue({ id: 901, pull_request: { url: 'https://ignored.test' } }), issue({ id: 902, body: 123 })]);
    expect(result.completeness).toBe('partial');
    if (!('entries' in result)) throw Error('list expected');
    expect(result.entries.map(entry => entry.kind)).toEqual(['value', 'excluded', 'unavailable']);
    expect(result.entries[1]).toMatchObject({ kind: 'excluded', reason: 'PULL_REQUEST', objectId: '901' });
  });
  it('marks null author/body partial and never treats null as an empty body or current user', () => {
    const result = object(issue({ body: null, user: null }));
    expect(result.body).toBeNull(); expect(result.authorId).toBeNull(); expect(result.completeness).toBe('partial');
    expect(result.partialReasons).toEqual(['AUTHOR_UNKNOWN', 'BODY_UNAVAILABLE']);
    const missing: Record<string, unknown> = issue(); delete missing.user;
    expect(decodeGithubObject({ schemaVersion: 1, kind: 'issue', raw: missing, boundRepository: bound, parentIssue: null, representationTag: 'etag:one' }).kind).toBe('unavailable');
  });
  it.each([9007199254740992, 0, -1, 1.5, '001', '1e3'])('rejects unsafe or noncanonical provider IDs %j', id => {
    const result = page('issues', [issue({ id })]);
    expect(result.completeness).toBe('partial'); if ('entries' in result) expect(result.entries[0]?.kind).toBe('unavailable');
  });
  it('validates parent identity and scopes without following provider URLs', () => {
    expect(object(comment(), 'comment').issueId).toBe('900');
    for (const issue_url of ['https://evil.test/repos/octo/demo/issues/7', 'https://api.github.com/repos/octo/else/issues/7', 'https://api.github.com/repos/octo/demo/issues/8']) {
      expect(decodeGithubObject({ schemaVersion: 1, kind: 'comment', raw: comment({ issue_url }), boundRepository: bound, parentIssue: parent, representationTag: 'etag:one' }).kind).toBe('unavailable');
    }
    expect(decodeGithubObject({ schemaVersion: 1, kind: 'comment', raw: comment(), boundRepository: bound, parentIssue: { ...parent, isPullRequest: true }, representationTag: 'etag:one' })).toMatchObject({ kind: 'excluded', reason: 'PULL_REQUEST' });
  });
  it('decodes all provider page kinds with declared fields and additional real provider JSON', () => {
    expect(page('user', { ...author, id: 12 }).kind).toBe('user');
    expect(page('repository', { id: 123, node_id: 'R_123', name: 'demo', owner: { id: 13, login: 'octo' }, private: true }).kind).toBe('repository');
    expect(page('labels', [{ id: 55, node_id: 'L_55', name: 'allowed', color: 'ffffff' }]).kind).toBe('labels');
    expect(page('issue', issue(), parent).kind).toBe('issue');
    expect(page('issue_comments', [comment()], parent).kind).toBe('issue_comments');
    expect(page('comment', comment(), parent).kind).toBe('comment');
    const ignored = page('events', [{ id: '801', type: 'WatchEvent', extra: true }]);
    expect(ignored.completeness).toBe('complete'); if ('entries' in ignored) expect(ignored.entries[0]).toMatchObject({ kind: 'excluded', reason: 'OTHER_EVENT' });
  });
  it('rejects malformed/fatal UTF8, byte overflow, nonJSON and invalid local page DTOs', () => {
    const base = { schemaVersion: 1, kind: 'issues', boundRepository: bound, parentIssue: null, representationTag: 'etag:one', maxBytes: 100 };
    expect(() => decodeGithubPage({ ...base, bytes: new Uint8Array([0xc3, 0x28]) })).toThrow();
    expect(() => decodeGithubPage({ ...base, bytes: bytes([issue()]) })).toThrow();
    expect(() => decodeGithubPage({ ...base, bytes: new TextEncoder().encode('not json') })).toThrow();
    expect(() => decodeGithubPage({ ...base, maxBytes: 1024 * 1024, bytes: bytes([]), extra: true })).toThrow();
    expect(() => decodeGithubPage({ ...base, bytes: Object.assign(bytes([]), { hiddenTail: Promise.resolve() }) })).toThrow();
  });
  it('hashes the same copied raw bytes with the independent frozen byte-domain vector', () => {
    const input = { schemaVersion: 1, kind: 'issues', boundRepository: bound, parentIssue: null, representationTag: 'etag:one', maxBytes: 100 };
    for (const payload of [new Uint8Array([91, 93]), Buffer.from('[]')]) {
      const decoded = decodeGithubPage({ ...input, bytes: payload });
      // SHA256(UTF8(domain) || 00 || uint64be(2) || 5b5d), independently calculated.
      expect(decoded.rawBodyHash).toBe('5a239541ec42e4d0c9df4b94c621a1fc298c774b4d7a42c51fae652472130a56');
      payload[0] = 32;
      expect(decoded.rawBodyHash).toBe('5a239541ec42e4d0c9df4b94c621a1fc298c774b4d7a42c51fae652472130a56');
    }
  });
  it('rejects SharedArrayBuffer, detached bytes, subclasses, and nonplain page DTOs', () => {
    const input = { schemaVersion: 1, kind: 'issues', boundRepository: bound, parentIssue: null, representationTag: 'etag:one', maxBytes: 100 };
    const shared = new Uint8Array(new SharedArrayBuffer(2)); shared.set([91, 93]);
    expect(() => decodeGithubPage({ ...input, bytes: shared })).toThrow();
    const detached = new Uint8Array([91, 93]); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => decodeGithubPage({ ...input, bytes: detached })).toThrow();
    class ByteSubclass extends Uint8Array {}
    expect(() => decodeGithubPage({ ...input, bytes: new ByteSubclass([91, 93]) })).toThrow();
    class PageInput { constructor() { Object.assign(this, input, { bytes: bytes([]) }); } }
    expect(() => decodeGithubPage(new PageInput())).toThrow();
  });
  it('preserves missing provider fields and unknown actors as partial page entries', () => {
    const raw = { id: '800', type: 'IssuesEvent', actor: null, repo: { id: 123, name: 'octo/demo' }, created_at: at, payload: { action: 'opened', issue: issue() } };
    const decoded = page('events', [raw, { ...raw, id: '801', payload: { action: 'opened' } }]);
    expect(decoded.completeness).toBe('partial');
    if ('entries' in decoded) expect(decoded.entries.map(entry => entry.kind)).toEqual(['value', 'unavailable']);
    expect(page('events', [raw]).completeness).toBe('partial');
    expect(decodeGithubObject({ schemaVersion: 1, kind: 'issue', raw: issue({ repository_url: 'https://api.github.com/repos/octo/else' }), boundRepository: bound, parentIssue: null, representationTag: 'etag:one' })).toEqual({ kind: 'unavailable', reason: 'SCOPE_MISMATCH' });
  });
  it('direct raw entry refuses getter/proxy/symbol tails with zero user calls', () => {
    let calls = 0; const raw = issue();
    Object.defineProperty(raw, 'ignored', { get() { calls++; return 'bad'; }, enumerable: true });
    const input = (value: unknown) => ({ schemaVersion: 1, kind: 'issue', raw: value, boundRepository: bound, parentIssue: null, representationTag: 'etag:one' });
    expect(() => decodeGithubObject(input(raw))).toThrow();
    expect(() => decodeGithubObject(input(new Proxy({}, { ownKeys() { calls++; return []; } })))).toThrow();
    expect(() => decodeGithubObject(input({ ...issue(), [Symbol('tail')]: Promise.resolve() }))).toThrow(); expect(calls).toBe(0);
  });
  it('late Array.map cannot delete provider candidates and report an empty complete page', () => {
    const input = { schemaVersion: 1, kind: 'issues', boundRepository: bound, parentIssue: null, representationTag: 'etag:one', maxBytes: 1024 * 1024, bytes: bytes([issue()]) };
    const original = Array.prototype.map; let decoded: ReturnType<typeof decodeGithubPage> | undefined;
    Array.prototype.map = function () { return []; };
    try { decoded = decodeGithubPage(input); } finally { Array.prototype.map = original; }
    expect(decoded && 'entries' in decoded ? decoded.entries : undefined).toHaveLength(1);
    expect(decoded && 'entries' in decoded ? decoded.entries[0]?.kind : undefined).toBe('value');
  });
});

describe('G05-G09 creation matching supplies data only', () => {
  it('refuses the obsolete global-history field instead of accepting a fake proven assertion', () => {
    for (const historyCoverage of ['unknown', 'proven']) {
      expect(() => matchGithubCreation(event(), object(), { ...context(), historyCoverage })).toThrow('dsh_github_read_contract');
    }
  });
  it('matches complete selected evidence with no global history assertion', () => {
    expect(matchGithubCreation(event(), object(), context()).kind).toBe('matched');
  });
  it.each(['issue', 'comment'] as const)('matches exact %s event payload and current representation', kind => {
    const matched = matchGithubCreation(event(kind), object(kind === 'issue' ? issue() : comment(), kind), context());
    expect(matched).toMatchObject({ kind: 'matched', eventId: '800', triggerActorId: '12', objectAuthorId: '12', repositoryId: '123' });
    expect(matched).not.toHaveProperty('verified_event'); expect(matched).not.toHaveProperty('authorization');
  });
  it.each([
    { body: 'edited despite same timestamp' }, { title: 'edited title' }, { user: { ...author, id: 14 } }, { id: 901 },
  ])('same actor/time cannot wash changed current payload %j', patch => {
    expect(matchGithubCreation(event(), object(issue(patch)), context()).kind).toBe('unknown');
  });
  it('keeps trigger actor distinct from creator, but checks the two payload creators exactly', () => {
    const differentActor = event('issue', { actor: { id: 15, login: 'delegate' } });
    expect(matchGithubCreation(differentActor, object(), context())).toMatchObject({ kind: 'matched', triggerActorId: '15', objectAuthorId: '12' });
    expect(matchGithubCreation(event(), object(issue({ user: null })), context()).kind).toBe('unknown');
  });
  it.each([
    { pagination: 'unknown' }, { pagination: 'partial' }, { currentFreshness: 'unknown' }, { currentRepresentationTag: 'other' },
  ])('cannot turn missing coverage/freshness into evidence %j', patch => {
    expect(matchGithubCreation(event(), object(), { ...context(), ...patch }).kind).toBe('unknown');
  });
  it('rejects prewindow/closed-window/future event matches and caller forged hashes', () => {
    expect(matchGithubCreation(event('issue', { created_at: '2026-11-04T00:00:00Z' }), object(), context()).kind).toBe('unknown');
    expect(matchGithubCreation(event(), object(), { ...context(), window: { ...context().window, sourceSnapshotAt: '2026-11-05T23:59:00Z' } }).kind).toBe('unknown');
    expect(matchGithubCreation(event(), object(), { ...context(), window: { ...context().window, observationsEndAt: at } }).kind).toBe('unknown');
    expect(() => matchGithubCreation(event(), { ...object(), contentHash: 'a'.repeat(64) }, context())).toThrow();
  });
  it('edits/deletes/other actions do not become creation evidence', () => {
    for (const action of ['edited', 'deleted', 'labeled']) {
      expect(matchGithubCreation(event('issue', { payload: { action, issue: issue() } }), object(), context())).toMatchObject({ kind: 'excluded', reason: 'OTHER_ACTION' });
    }
  });
  it('label selector uses frozen IDs and all semantics, never label name or actor permission', () => {
    const labelContext = { ...context(), selector: { kind: 'label_ids', match: 'all', labelIds: ['55'], parentIssueLabelIds: ['55'] } };
    expect(matchGithubCreation(event(), object(), labelContext).kind).toBe('matched');
    expect(matchGithubCreation(event('comment'), object(comment(), 'comment'), labelContext).kind).toBe('matched');
    expect(matchGithubCreation(event(), object(), { ...labelContext, selector: { ...labelContext.selector, labelIds: ['56'] } })).toMatchObject({ kind: 'excluded', reason: 'OUTSIDE_SELECTOR' });
    expect(() => matchGithubCreation(event(), object(), { ...labelContext, selector: { ...labelContext.selector, labelName: 'allowed' } })).toThrow();
    expect(() => matchGithubCreation(event(), object(), { ...labelContext, selector: { kind: 'label_ids', match: 'all', labelIds: ['55'] } })).toThrow();
  });
  it('cannot wash an old object into a new creation event or bind a contradictory parent label fact', () => {
    const old = issue({ created_at: '2026-11-01T00:00:00Z' });
    expect(matchGithubCreation(event('issue', { payload: { action: 'opened', issue: old } }), object(old), context()).kind).toBe('unknown');
    const bad = { ...context(), selector: { kind: 'label_ids', match: 'all', labelIds: ['55'], parentIssueLabelIds: ['56'] } };
    expect(matchGithubCreation(event(), object(), bad).kind).toBe('unknown');
  });
});

describe('G10 opaque representation comparison never invents ordering', () => {
  it('distinguishes same, conflicting content, other object and incomparable tag', () => {
    expect(compareGithubRepresentations(object(), object())).toBe('same');
    expect(compareGithubRepresentations(object(), object(issue({ body: 'changed' })))).toBe('conflict');
    expect(compareGithubRepresentations(object(), object(issue(), 'issue', 'etag:two'))).toBe('incomparable');
    expect(compareGithubRepresentations(object(), object(issue({ id: 901 })))).toBe('different_object');
  });
});
