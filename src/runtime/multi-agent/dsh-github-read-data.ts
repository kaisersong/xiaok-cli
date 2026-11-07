import { createHash, Hash } from 'node:crypto';
import { types } from 'node:util';
import { canonicalVerificationJson } from '../verification/protocol.js';

// S0 only: these parsers and matches are data, never authenticated Source frames.
const ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
const own = Object.hasOwn, prototype = Object.getPrototypeOf, isArray = Array.isArray;
const isProxy = types.isProxy, isUint8Array = types.isUint8Array, isShared = types.isSharedArrayBuffer;
const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;
const nativeDefine = Object.defineProperty, nativeCreate = Object.create, nativeFreeze = Object.freeze;
const nativeSort = Array.prototype.sort, nativeJoin = Array.prototype.join, nativeRegexExec = RegExp.prototype.exec;
const nativeSafeInteger = Number.isSafeInteger, nativeFinite = Number.isFinite, nativeByteLength = Buffer.byteLength;
const NativeSet = Set, setHas = Set.prototype.has, setAdd = Set.prototype.add, setDelete = Set.prototype.delete;
const setSize = descriptor(Set.prototype, 'size')!.get!, NativeError = Error;
const stringSlice = String.prototype.slice, stringPadEnd = String.prototype.padEnd;
const nativeString = String, nativeNumber = Number, nativeBigInt = BigInt;
const bytePrototype = Uint8Array.prototype, bufferPrototype = Buffer.prototype;
const typedPrototype = prototype(bytePrototype);
const byteLengthGetter = descriptor(typedPrototype, 'byteLength')!.get!;
const bufferGetter = descriptor(typedPrototype, 'buffer')!.get!;
const typedSet = bytePrototype.set, apply = Reflect.apply, NativeUint8Array = Uint8Array;
const NativeDecoder = TextDecoder, decoderDecode = TextDecoder.prototype.decode, parseJson = JSON.parse;
const NativeDate = Date, dateParse = Date.parse, dateIso = Date.prototype.toISOString;
const hashUpdate = Hash.prototype.update, hashDigest = Hash.prototype.digest, nativeCreateHash = createHash;
const nativeBufferAlloc = Buffer.alloc, nativeWriteBigUInt64BE = Buffer.prototype.writeBigUInt64BE;
const MAX_BYTES = 1024 * 1024;
type RecordData = Record<string, unknown>;
export function githubReadFail(): never { throw new NativeError('dsh_github_read_contract'); }
export const githubReadOwn = own;
export function githubReadTest(regex: RegExp, value: string): boolean { return apply(nativeRegexExec, regex, [value]) !== null; }
function defineData(target: object, key: PropertyKey, value: unknown): void {
  nativeDefine(target, key, { __proto__: null, value, enumerable: true, writable: true, configurable: true } as PropertyDescriptor);
}
export function githubReadMap<T, R>(values: readonly T[], fn: (value: T) => R): R[] {
  const result: R[] = []; for (let i = 0; i < values.length; i++) defineData(result, nativeString(i), fn(values[i]!)); return result;
}
export function githubReadSome<T>(values: readonly T[], fn: (value: T) => unknown): boolean {
  for (let i = 0; i < values.length; i++) if (fn(values[i]!)) return true; return false;
}
export function githubReadIncludes<T>(values: readonly T[], value: unknown): boolean {
  return githubReadSome(values, item => item === value);
}
export function githubReadSort<T>(values: T[], compare?: (a: T, b: T) => number): T[] { return apply(nativeSort, values, [compare]) as T[]; }
export function githubReadAppend<T>(values: T[], value: T): void { defineData(values, nativeString(values.length), value); }
export function githubReadJoin(values: readonly string[], separator: string): string { return apply(nativeJoin, values, [separator]) as string; }
export function githubReadUnique(values: readonly string[]): boolean {
  const seen = new NativeSet<string>();
  for (let i = 0; i < values.length; i++) apply(setAdd, seen, [values[i]!]);
  return apply(setSize, seen, []) === values.length;
}

/** Descriptor capture for this protocol. Does not execute getters, Proxy traps or toJSON. */
export function captureGithubReadData(input: unknown): unknown {
  const active = new NativeSet<object>(); let count = 0;
  function copy(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!nativeFinite(value)) githubReadFail(); return value; }
    if (!value || typeof value !== 'object' || isProxy(value) || depth > 64 || ++count > 50_000 || apply(setHas, active, [value])) githubReadFail();
    const array = isArray(value), proto = prototype(value);
    if (array ? proto !== arrayPrototype : proto !== objectPrototype && proto !== null) githubReadFail();
    apply(setAdd, active, [value]);
    const result: RecordData | unknown[] = array ? [] : nativeCreate(null);
    const names = ownKeys(value);
    let length = 0;
    if (array) { const row = descriptor(value, 'length'); if (!row || !own(row, 'value') || !nativeSafeInteger(row.value) || row.value > 50_000) githubReadFail(); length = row.value; }
    for (let i = 0; i < names.length; i++) { const key = names[i]!;
      if (typeof key !== 'string') githubReadFail();
      const row = descriptor(value, key);
      if (!row || !own(row, 'value') || key !== 'length' && !row.enumerable) githubReadFail();
      if (array && key === 'length') continue;
      if (array && (!githubReadTest(/^(0|[1-9][0-9]*)$/, key) || nativeNumber(key) >= length)) githubReadFail();
      defineData(result, key, copy(row.value, depth + 1));
    }
    if (array && names.length !== length + 1) githubReadFail();
    apply(setDelete, active, [value]); return result;
  }
  return copy(input, 0);
}
/** Shallow fixed-shape host options/opaque-reference capture; does not grant membership. */
export function captureGithubOpaqueRecord(raw:unknown,names:readonly string[]):RecordData {
 if(!raw||typeof raw!=='object'||isProxy(raw)||isArray(raw)||prototype(raw)!==objectPrototype&&prototype(raw)!==null)githubReadFail();
 const r=raw as RecordData;githubReadFields(r,names);const out=nativeCreate(null) as RecordData;
 for(let i=0;i<names.length;i++){const key=names[i]!,row=descriptor(r,key);if(!row||!own(row,'value')||!row.enumerable)githubReadFail();out[key]=row.value;}
 return out;
}
export function githubReadRecord(value: unknown): RecordData {
  if (!value || typeof value !== 'object' || isArray(value)) githubReadFail();
  return value as RecordData;
}
export function githubReadFields(value: RecordData, names: readonly string[]): void {
  const actual = ownKeys(value);
  if (actual.length !== names.length || githubReadSome(actual, key => typeof key !== 'string' || !githubReadIncludes(names, key))) githubReadFail();
}
export function githubReadText(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || nativeByteLength(value) > maximum || githubReadTest(/[\u0000-\u001f\u007f]/, value)) githubReadFail();
  return value;
}
export function githubReadId(value: unknown): string {
  if (typeof value === 'number') { if (!nativeSafeInteger(value) || value <= 0) githubReadFail(); return nativeString(value); }
  if (typeof value !== 'string' || !githubReadTest(/^[1-9][0-9]{0,19}$/, value)) githubReadFail();
  return value;
}
export function githubReadTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !githubReadTest(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, value)) githubReadFail();
  const time = dateParse(value); if (!nativeFinite(time)) githubReadFail();
  const normalized = apply(dateIso, new NativeDate(time), []) as string;
  const prefix = apply(stringSlice, value, [0, 19]) as string;
  const fraction = value.length === 20 ? '' : apply(stringSlice, value, [20, -1]) as string;
  const padded = `${prefix}.${apply(stringPadEnd, fraction, [3, '0'])}Z`;
  if (normalized !== padded) githubReadFail(); return normalized;
}
export function githubReadFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { const keys = ownKeys(value); for (let i = 0; i < keys.length; i++) githubReadFreeze((value as Record<PropertyKey, unknown>)[keys[i]!]); nativeFreeze(value); }
  return value;
}
export function githubReadHash(domain: string, value: unknown): string {
  const state = nativeCreateHash('sha256');
  apply(hashUpdate, state, [canonicalVerificationJson([domain, value])]);
  return apply(hashDigest, state, ['hex']) as string;
}
export interface GithubBoundRepository { repositoryId: string; nodeId: string; owner: string; repo: string }
export interface GithubParentIssue { repositoryId: string; issueId: string; nodeId: string; number: number; isPullRequest: boolean }
export function parseGithubBoundRepository(input: unknown): GithubBoundRepository {
  const r = githubReadRecord(input); githubReadFields(r, ['repositoryId', 'nodeId', 'owner', 'repo']);
  const repositoryId = githubReadId(r.repositoryId), nodeId = githubReadText(r.nodeId);
  if (typeof r.repositoryId !== 'string' || typeof r.owner !== 'string' || !githubReadTest(/^[A-Za-z0-9-]{1,39}$/, r.owner)
    || typeof r.repo !== 'string' || !githubReadTest(/^[A-Za-z0-9_.-]{1,100}$/, r.repo) || r.repo === '.' || r.repo === '..') githubReadFail();
  return { repositoryId, nodeId, owner: r.owner, repo: r.repo };
}
export function parseGithubParentIssue(input: unknown, bound: GithubBoundRepository): GithubParentIssue {
  const r = githubReadRecord(input); githubReadFields(r, ['repositoryId', 'issueId', 'nodeId', 'number', 'isPullRequest']);
  if (r.repositoryId !== bound.repositoryId || typeof r.issueId !== 'string' || typeof r.number !== 'number' || !nativeSafeInteger(r.number) || r.number < 1 || typeof r.isPullRequest !== 'boolean') githubReadFail();
  return { repositoryId: bound.repositoryId, issueId: githubReadId(r.issueId), nodeId: githubReadText(r.nodeId), number: r.number, isPullRequest: r.isPullRequest };
}
export type GithubRequestKind = 'user' | 'repository' | 'labels' | 'issues' | 'issue' | 'issue_comments' | 'comment' | 'events';
export interface GithubUser { id: string; nodeId: string; login: string }
export interface GithubRepository { id: string; nodeId: string; owner: string; repo: string; ownerId: string }
export interface GithubLabel { id: string; nodeId: string; name: string }
export interface GithubObjectV1 {
  objectKind: 'issue' | 'comment'; objectId: string; nodeId: string; repositoryId: string;
  issueId: string; issueNodeId: string; issueNumber: number; authorId: string | null; authorNodeId: string | null;
  title: string | null; body: string | null; createdAt: string; updatedAt: string; labelIds: readonly string[];
  state: 'open' | 'closed' | null; locked: boolean | null; representationTag: string; contentHash: string;
  completeness: 'complete' | 'partial'; partialReasons: readonly ('AUTHOR_UNKNOWN' | 'BODY_UNAVAILABLE')[];
}
export type GithubEntry<T> = Readonly<{ kind: 'value'; value: T }
  | { kind: 'excluded'; reason: 'PULL_REQUEST' | 'OTHER_EVENT'; objectId: string | null }
  | { kind: 'unavailable'; reason: 'PROVIDER_OBJECT_INVALID' | 'SCOPE_MISMATCH' }>;
export interface GithubEvent {
  eventId: string; eventType: 'IssuesEvent' | 'IssueCommentEvent'; action: string; actorId: string | null;
  repositoryId: string; repositoryName: string; createdAt: string; object: GithubObjectV1;
}
const unavailable = (reason: 'PROVIDER_OBJECT_INVALID' | 'SCOPE_MISMATCH' = 'PROVIDER_OBJECT_INVALID'): GithubEntry<never> => ({ kind: 'unavailable', reason });
function uniqueIds(values: unknown): string[] {
  if (!isArray(values)) githubReadFail(); const ids = githubReadSort(githubReadMap(values, githubReadId));
  if (!githubReadUnique(ids)) githubReadFail(); return ids;
}
function providerAuthor(raw: unknown): { authorId: string | null; authorNodeId: string | null } {
  if (raw === null) return { authorId: null, authorNodeId: null };
  const r = githubReadRecord(raw); return { authorId: githubReadId(r.id), authorNodeId: githubReadText(r.node_id) };
}
function objectContent(value: Omit<GithubObjectV1, 'contentHash'> | GithubObjectV1): unknown {
  const { representationTag: _tag, contentHash: _hash, completeness: _complete, partialReasons: _reasons, ...content } = value as GithubObjectV1;
  return content;
}
function providerObject(kind: 'issue' | 'comment', raw: unknown, bound: GithubBoundRepository, parent: GithubParentIssue | null, tag: string): GithubEntry<GithubObjectV1> {
  try {
    const r = githubReadRecord(raw), objectId = githubReadId(r.id);
    if (kind === 'issue' && own(r, 'pull_request') || kind === 'comment' && parent?.isPullRequest) return { kind: 'excluded', reason: 'PULL_REQUEST', objectId };
    if (!own(r, 'body') || !own(r, 'user') || r.body !== null && typeof r.body !== 'string') return unavailable();
    if (typeof r.body === 'string' && nativeByteLength(r.body) > 64 * 1024) return unavailable();
    const author = providerAuthor(r.user), nodeId = githubReadText(r.node_id), createdAt = githubReadTimestamp(r.created_at), updatedAt = githubReadTimestamp(r.updated_at);
    if (dateParse(updatedAt) < dateParse(createdAt)) return unavailable();
    let issueId: string, issueNodeId: string, issueNumber: number, title: string | null = null;
    let state: 'open' | 'closed' | null = null, locked: boolean | null = null, labelIds: string[] = [];
    if (kind === 'issue') {
      if (r.repository_url !== `https://api.github.com/repos/${bound.owner}/${bound.repo}`) return unavailable('SCOPE_MISMATCH');
      if (typeof r.number !== 'number' || !nativeSafeInteger(r.number) || r.number < 1 || typeof r.title !== 'string' || nativeByteLength(r.title) > 64 * 1024
        || !isArray(r.labels) || r.state !== 'open' && r.state !== 'closed' || typeof r.locked !== 'boolean') return unavailable();
      issueId = objectId; issueNodeId = nodeId; issueNumber = r.number; title = r.title; state = r.state; locked = r.locked;
      labelIds = uniqueIds(githubReadMap(r.labels, label => githubReadRecord(label).id));
      if (parent && (parent.issueId !== issueId || parent.nodeId !== nodeId || parent.number !== issueNumber)) return unavailable('SCOPE_MISMATCH');
    } else {
      if (!parent) return unavailable('SCOPE_MISMATCH');
      if (r.issue_url !== `https://api.github.com/repos/${bound.owner}/${bound.repo}/issues/${parent.number}`) return unavailable('SCOPE_MISMATCH');
      issueId = parent.issueId; issueNodeId = parent.nodeId; issueNumber = parent.number;
    }
    const partialReasons: ('AUTHOR_UNKNOWN' | 'BODY_UNAVAILABLE')[] = [];
    if (author.authorId === null) githubReadAppend(partialReasons, 'AUTHOR_UNKNOWN'); if (r.body === null) githubReadAppend(partialReasons, 'BODY_UNAVAILABLE');
    const value: GithubObjectV1 = { objectKind: kind, objectId, nodeId, repositoryId: bound.repositoryId, issueId, issueNodeId, issueNumber, ...author,
      title, body: r.body as string | null, createdAt, updatedAt, labelIds, state, locked, representationTag: tag, contentHash: '', completeness: partialReasons.length ? 'partial' : 'complete', partialReasons };
    value.contentHash = githubReadHash('dsh-github-object-content-v1', objectContent(value));
    return { kind: 'value', value };
  } catch { return unavailable(); }
}
export interface GithubObjectInput { schemaVersion: 1; kind: 'issue' | 'comment'; raw: unknown; boundRepository: GithubBoundRepository; parentIssue: GithubParentIssue | null; representationTag: string }
export function decodeGithubObject(input: unknown): GithubEntry<GithubObjectV1> {
  const r = githubReadRecord(captureGithubReadData(input)); githubReadFields(r, ['schemaVersion', 'kind', 'raw', 'boundRepository', 'parentIssue', 'representationTag']);
  if (r.schemaVersion !== 1 || r.kind !== 'issue' && r.kind !== 'comment') githubReadFail();
  const bound = parseGithubBoundRepository(r.boundRepository), parent = r.parentIssue === null ? null : parseGithubParentIssue(r.parentIssue, bound);
  if (r.kind === 'comment' && !parent) githubReadFail();
  return githubReadFreeze(providerObject(r.kind, r.raw, bound, parent, githubReadText(r.representationTag, 1024)));
}
function providerEvent(raw: unknown, bound: GithubBoundRepository, tag: string): GithubEntry<GithubEvent> {
  try {
    const r = githubReadRecord(raw), eventId = githubReadId(r.id), type = githubReadText(r.type);
    if (type !== 'IssuesEvent' && type !== 'IssueCommentEvent') return { kind: 'excluded', reason: 'OTHER_EVENT', objectId: eventId };
    const repo = githubReadRecord(r.repo), payload = githubReadRecord(r.payload), issue = githubReadRecord(payload.issue);
    const repositoryId = githubReadId(repo.id), repositoryName = githubReadText(repo.name), createdAt = githubReadTimestamp(r.created_at);
    if (repositoryId !== bound.repositoryId || repositoryName !== `${bound.owner}/${bound.repo}`) return unavailable('SCOPE_MISMATCH');
    let actorId: string | null = null; if (r.actor !== null) actorId = githubReadId(githubReadRecord(r.actor).id);
    const issueEntry = providerObject('issue', issue, bound, null, tag);
    if (issueEntry.kind !== 'value') return issueEntry;
    const p: GithubParentIssue = { repositoryId, issueId: issueEntry.value.issueId, nodeId: issueEntry.value.issueNodeId, number: issueEntry.value.issueNumber, isPullRequest: false };
    const entry = type === 'IssuesEvent' ? issueEntry : providerObject('comment', payload.comment, bound, p, tag);
    if (entry.kind !== 'value') return entry;
    return { kind: 'value', value: { eventId, eventType: type, action: githubReadText(payload.action), actorId, repositoryId, repositoryName, createdAt, object: entry.value } };
  } catch { return unavailable(); }
}
export interface GithubPageInput { schemaVersion: 1; kind: GithubRequestKind; boundRepository: GithubBoundRepository | null; parentIssue: GithubParentIssue | null; bytes: Uint8Array; maxBytes: number; representationTag: string | null }
type PageMeta = { completeness: 'complete' | 'partial'; rawBodyHash: string };
export type GithubDecodedPage = Readonly<PageMeta & (
  { kind: 'user'; entry: GithubEntry<GithubUser> } | { kind: 'repository'; entry: GithubEntry<GithubRepository> }
  | { kind: 'labels'; entries: readonly GithubEntry<GithubLabel>[] } | { kind: 'events'; entries: readonly GithubEntry<GithubEvent>[] }
  | { kind: 'issues' | 'issue_comments'; entries: readonly GithubEntry<GithubObjectV1>[] }
  | { kind: 'issue' | 'comment'; entry: GithubEntry<GithubObjectV1> }
)>;
function copyBytes(raw: unknown, maximum: number): Uint8Array {
  if (!raw || typeof raw !== 'object' || isProxy(raw) || !isUint8Array(raw) || prototype(raw) !== bytePrototype && prototype(raw) !== bufferPrototype) githubReadFail();
  const buffer = apply(bufferGetter, raw, []) as ArrayBuffer;
  if (isShared(buffer)) githubReadFail();
  const length = apply(byteLengthGetter, raw, []) as number;
  if (!length || length > maximum) githubReadFail();
  const keys = ownKeys(raw);
  if (keys.length !== length || githubReadSome(keys, key => typeof key !== 'string' || !githubReadTest(/^(0|[1-9][0-9]*)$/, key) || nativeNumber(key) >= length)) githubReadFail();
  const result = new NativeUint8Array(length);
  try { apply(typedSet, result, [raw]); } catch { githubReadFail(); }
  return result;
}
function rawBytesHash(bytes: Uint8Array): string {
  const state = nativeCreateHash('sha256'), length = nativeBufferAlloc(8); apply(nativeWriteBigUInt64BE, length, [nativeBigInt(bytes.byteLength)]);
  apply(hashUpdate, state, ['dsh-github-provider-bytes-v1\0']); apply(hashUpdate, state, [length]); apply(hashUpdate, state, [bytes]);
  return apply(hashDigest, state, ['hex']) as string;
}
/** Shared bounded original-byte parser for fixed GitHub response decoders. Data only. */
export function decodeGithubProviderBytes(bytes:unknown,maxBytes:number):{value:unknown;rawBodyHash:string}{
 if(!nativeSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)githubReadFail();
 const copied=copyBytes(bytes,maxBytes),rawBodyHash=rawBytesHash(copied);let value:unknown;
 try{value=captureGithubReadData(parseJson(apply(decoderDecode,new NativeDecoder('utf-8',{fatal:true}),[copied]) as string));}catch{githubReadFail();}
 return githubReadFreeze({value,rawBodyHash});
}
export function decodeGithubPage(input: unknown): GithubDecodedPage {
  // Capture the bytes separately: protocol capture never serializes a typed array.
  if (!input || typeof input !== 'object' || isProxy(input) || prototype(input) !== objectPrototype && prototype(input) !== null) githubReadFail();
  const raw = githubReadRecord(input), keys = ownKeys(raw), shallow: RecordData = nativeCreate(null);
  for (let i = 0; i < keys.length; i++) { const key = keys[i]!;
    if (typeof key !== 'string') githubReadFail(); const row = descriptor(raw, key);
    if (!row || !own(row, 'value') || !row.enumerable) githubReadFail();
    if (key !== 'bytes') shallow[key] = row.value;
  }
  const r = githubReadRecord(captureGithubReadData(shallow));
  githubReadFields(r, ['schemaVersion', 'kind', 'boundRepository', 'parentIssue', 'maxBytes', 'representationTag']);
  const byteRow = descriptor(raw, 'bytes'); if (!byteRow || !own(byteRow, 'value') || keys.length !== 7 || r.schemaVersion !== 1
    || typeof r.maxBytes !== 'number' || !nativeSafeInteger(r.maxBytes) || r.maxBytes < 1 || r.maxBytes > MAX_BYTES) githubReadFail();
  const kinds = ['user', 'repository', 'labels', 'issues', 'issue', 'issue_comments', 'comment', 'events'];
  if (!githubReadIncludes(kinds, r.kind)) githubReadFail(); const kind = r.kind as GithubRequestKind;
  const bound = r.boundRepository === null ? null : parseGithubBoundRepository(r.boundRepository);
  const parent = r.parentIssue === null ? null : bound ? parseGithubParentIssue(r.parentIssue, bound) : githubReadFail();
  if (kind === 'user' ? bound !== null || parent !== null || r.representationTag !== null : bound === null) githubReadFail();
  if (githubReadIncludes(['repository', 'labels', 'events', 'issues'], kind) && parent !== null) githubReadFail();
  if (githubReadIncludes(['issue', 'issue_comments', 'comment'], kind) && !parent) githubReadFail();
  const tag = r.representationTag === null ? null : githubReadText(r.representationTag, 1024);
  if (githubReadIncludes(['issues', 'issue', 'issue_comments', 'comment', 'events'], kind) && tag === null) githubReadFail();
  if (githubReadIncludes(['repository', 'labels'], kind) && tag !== null) githubReadFail();
  const {value,rawBodyHash}=decodeGithubProviderBytes(byteRow.value,r.maxBytes);
  const decodeOne = (item: unknown): GithubEntry<unknown> => {
    if (kind === 'issues' || kind === 'issue') return providerObject('issue', item, bound!, parent, tag!);
    if (kind === 'issue_comments' || kind === 'comment') return providerObject('comment', item, bound!, parent, tag!);
    if (kind === 'events') return providerEvent(item, bound!, tag!);
    try {
      const p = githubReadRecord(item), id = githubReadId(p.id), nodeId = githubReadText(p.node_id);
      if (kind === 'user') return { kind: 'value', value: { id, nodeId, login: githubReadText(p.login) } };
      if (kind === 'labels') return { kind: 'value', value: { id, nodeId, name: githubReadText(p.name) } };
      const owner = githubReadRecord(p.owner), name = githubReadText(p.name), login = githubReadText(owner.login), ownerId = githubReadId(owner.id);
      if (id !== bound!.repositoryId || nodeId !== bound!.nodeId || name !== bound!.repo || login !== bound!.owner) return unavailable('SCOPE_MISMATCH');
      return { kind: 'value', value: { id, nodeId, owner: login, repo: name, ownerId } };
    } catch { return unavailable(); }
  };
  const lists = githubReadIncludes(['labels', 'events', 'issues', 'issue_comments'], kind);
  if (lists && !isArray(value)) githubReadFail();
  const entries = lists ? githubReadMap(value as unknown[], decodeOne) : [decodeOne(value)];
  const partial = githubReadSome(entries, entry => entry.kind === 'unavailable' || entry.kind === 'value' && entry.value && typeof entry.value === 'object' && (entry.value as GithubObjectV1).completeness === 'partial'
    || kind === 'events' && entry.kind === 'value' && ((entry.value as GithubEvent).object.completeness === 'partial' || (entry.value as GithubEvent).actorId === null));
  return githubReadFreeze({ kind, completeness: partial ? 'partial' : 'complete', rawBodyHash, ...(lists ? { entries } : { entry: entries[0] }) }) as GithubDecodedPage;
}
const OBJECT_FIELDS = ['objectKind', 'objectId', 'nodeId', 'repositoryId', 'issueId', 'issueNodeId', 'issueNumber', 'authorId', 'authorNodeId', 'title', 'body', 'createdAt', 'updatedAt', 'labelIds', 'state', 'locked', 'representationTag', 'contentHash', 'completeness', 'partialReasons'];
export function localObject(input: unknown): GithubObjectV1 {
  const r = githubReadRecord(input); githubReadFields(r, OBJECT_FIELDS);
  if (r.objectKind !== 'issue' && r.objectKind !== 'comment' || typeof r.issueNumber !== 'number' || !nativeSafeInteger(r.issueNumber) || r.issueNumber < 1) githubReadFail();
  const idKeys = ['objectId', 'repositoryId', 'issueId']; for (let i = 0; i < idKeys.length; i++) { const key = idKeys[i]!; if (typeof r[key] !== 'string' || githubReadId(r[key]) !== r[key]) githubReadFail(); }
  githubReadText(r.nodeId); githubReadText(r.issueNodeId);
  githubReadText(r.representationTag, 1024);
  if ((r.authorId === null) !== (r.authorNodeId === null)) githubReadFail();
  if (r.authorId !== null) { if (typeof r.authorId !== 'string') githubReadFail(); githubReadId(r.authorId); githubReadText(r.authorNodeId); }
  if (r.body !== null && (typeof r.body !== 'string' || nativeByteLength(r.body) > 64 * 1024)) githubReadFail();
  const labels = uniqueIds(r.labelIds);
  if (canonicalVerificationJson(labels) !== canonicalVerificationJson(r.labelIds)) githubReadFail();
  if (r.objectKind === 'issue') { if (r.objectId !== r.issueId || r.nodeId !== r.issueNodeId || typeof r.title !== 'string' || nativeByteLength(r.title) > 64 * 1024 || !githubReadIncludes(['open', 'closed'], r.state) || typeof r.locked !== 'boolean') githubReadFail(); }
  else if (r.title !== null || r.state !== null || r.locked !== null || labels.length) githubReadFail();
  if (githubReadTimestamp(r.createdAt) !== r.createdAt || githubReadTimestamp(r.updatedAt) !== r.updatedAt || dateParse(r.updatedAt as string) < dateParse(r.createdAt as string)) githubReadFail();
  const reasons: string[] = []; if (r.authorId === null) githubReadAppend(reasons, 'AUTHOR_UNKNOWN'); if (r.body === null) githubReadAppend(reasons, 'BODY_UNAVAILABLE');
  if (r.completeness !== (reasons.length ? 'partial' : 'complete') || canonicalVerificationJson(reasons) !== canonicalVerificationJson(r.partialReasons)) githubReadFail();
  if (r.contentHash !== githubReadHash('dsh-github-object-content-v1', objectContent(r as unknown as GithubObjectV1))) githubReadFail();
  return r as unknown as GithubObjectV1;
}
export interface GithubMatchContext {
  schemaVersion: 1; boundRepository: GithubBoundRepository; parentIssue: GithubParentIssue;
  selector: { kind: 'issue_ids'; issueIds: readonly string[] } | { kind: 'label_ids'; match: 'all'; labelIds: readonly string[]; parentIssueLabelIds: readonly string[] };
  window: { effectiveAt: string; observationsEndAt: string; sourceSnapshotAt: string };
  currentRepresentationTag: string; currentFreshness: 'current' | 'unknown';
  /** Completeness of this candidate's frozen selected content lists, not the event feed's global history. */
  pagination: 'complete' | 'partial' | 'unknown';
}
export type GithubCreationMatch = Readonly<
  { kind: 'matched'; action: 'issue.created' | 'comment.created'; eventId: string; eventCreatedAt: string; triggerActorId: string; objectAuthorId: string; repositoryId: string; objectId: string; eventPayloadHash: string; currentSnapshotHash: string; representationTag: string }
  | { kind: 'excluded'; reason: 'PULL_REQUEST' | 'OUTSIDE_SELECTOR' | 'OTHER_ACTION' }
  | { kind: 'unknown'; reason: 'REPOSITORY_MISMATCH' | 'OBJECT_MISMATCH' | 'CONTENT_CHANGED' | 'CREATOR_MISMATCH' | 'FRESHNESS_UNPROVEN' | 'EVENT_PAYLOAD_INCOMPLETE' | 'SELECTED_PAGINATION_INCOMPLETE' }
>;
/** Compares normalized event/current data only. Caller facts never become authentication. */
export function matchGithubCreation(eventInput: unknown, currentInput: unknown, contextInput: unknown): GithubCreationMatch {
  const e = githubReadRecord(captureGithubReadData(eventInput)), current = localObject(captureGithubReadData(currentInput)), ctx = githubReadRecord(captureGithubReadData(contextInput));
  githubReadFields(e, ['eventId', 'eventType', 'action', 'actorId', 'repositoryId', 'repositoryName', 'createdAt', 'object']);
  if (typeof e.eventId !== 'string' || !githubReadIncludes(['IssuesEvent', 'IssueCommentEvent'], e.eventType) || typeof e.repositoryId !== 'string') githubReadFail();
  githubReadId(e.eventId); githubReadId(e.repositoryId); githubReadText(e.action); githubReadText(e.repositoryName);
  if (e.actorId !== null) { if (typeof e.actorId !== 'string') githubReadFail(); githubReadId(e.actorId); }
  const event = localObject(e.object), eventAt = githubReadTimestamp(e.createdAt);
  githubReadFields(ctx, ['schemaVersion', 'boundRepository', 'parentIssue', 'selector', 'window', 'currentRepresentationTag', 'currentFreshness', 'pagination']);
  if (ctx.schemaVersion !== 1 || !githubReadIncludes(['current', 'unknown'], ctx.currentFreshness) || !githubReadIncludes(['complete', 'partial', 'unknown'], ctx.pagination)) githubReadFail();
  const bound = parseGithubBoundRepository(ctx.boundRepository), parent = parseGithubParentIssue(ctx.parentIssue, bound), selector = githubReadRecord(ctx.selector), window = githubReadRecord(ctx.window);
  const tag = githubReadText(ctx.currentRepresentationTag, 1024);
  githubReadFields(window, ['effectiveAt', 'observationsEndAt', 'sourceSnapshotAt']);
  const start = dateParse(githubReadTimestamp(window.effectiveAt)), end = dateParse(githubReadTimestamp(window.observationsEndAt)), snapshot = dateParse(githubReadTimestamp(window.sourceSnapshotAt));
  if (end <= start) githubReadFail();
  let selected: string[], parentLabels: string[] = [];
  if (selector.kind === 'issue_ids') { githubReadFields(selector, ['kind', 'issueIds']); selected = uniqueIds(selector.issueIds); }
  else { githubReadFields(selector, ['kind', 'match', 'labelIds', 'parentIssueLabelIds']); if (selector.kind !== 'label_ids' || selector.match !== 'all') githubReadFail(); selected = uniqueIds(selector.labelIds); parentLabels = uniqueIds(selector.parentIssueLabelIds); }
  if (!selected.length) githubReadFail();
  const unknown = (reason: Extract<GithubCreationMatch, { kind: 'unknown' }>['reason']): GithubCreationMatch => githubReadFreeze({ kind: 'unknown', reason });
  if (parent.isPullRequest) return githubReadFreeze({ kind: 'excluded', reason: 'PULL_REQUEST' });
  if (!(e.eventType === 'IssuesEvent' && e.action === 'opened' && event.objectKind === 'issue' || e.eventType === 'IssueCommentEvent' && e.action === 'created' && event.objectKind === 'comment')) return githubReadFreeze({ kind: 'excluded', reason: 'OTHER_ACTION' });
  if (e.repositoryId !== bound.repositoryId || event.repositoryId !== bound.repositoryId || current.repositoryId !== bound.repositoryId || e.repositoryName !== `${bound.owner}/${bound.repo}`) return unknown('REPOSITORY_MISMATCH');
  if (event.objectKind !== current.objectKind || event.objectId !== current.objectId || event.nodeId !== current.nodeId || event.issueId !== current.issueId || event.issueId !== parent.issueId || current.issueNodeId !== parent.nodeId || current.issueNumber !== parent.number) return unknown('OBJECT_MISMATCH');
  if (event.completeness !== 'complete' || current.completeness !== 'complete' || e.actorId === null) return unknown('EVENT_PAYLOAD_INCOMPLETE');
  if (event.authorId !== current.authorId || event.authorNodeId !== current.authorNodeId) return unknown('CREATOR_MISMATCH');
  if (canonicalVerificationJson(objectContent(event)) !== canonicalVerificationJson(objectContent(current))) return unknown('CONTENT_CHANGED');
  if (selector.kind === 'label_ids' && current.objectKind === 'issue' && canonicalVerificationJson(parentLabels) !== canonicalVerificationJson(current.labelIds)) return unknown('OBJECT_MISMATCH');
  const accepted = selector.kind === 'issue_ids' ? githubReadIncludes(selected, current.issueId) : !githubReadSome(selected, id => !githubReadIncludes(parentLabels, id));
  if (!accepted) return githubReadFreeze({ kind: 'excluded', reason: 'OUTSIDE_SELECTOR' });
  if (ctx.currentFreshness !== 'current' || tag !== current.representationTag || dateParse(eventAt) < start || dateParse(eventAt) >= end || dateParse(eventAt) > snapshot || snapshot >= end
    || dateParse(current.createdAt) < start || dateParse(current.createdAt) > snapshot || dateParse(eventAt) < dateParse(current.createdAt)) return unknown('FRESHNESS_UNPROVEN');
  if (ctx.pagination !== 'complete') return unknown('SELECTED_PAGINATION_INCOMPLETE');
  return githubReadFreeze({ kind: 'matched', action: event.objectKind === 'issue' ? 'issue.created' : 'comment.created', eventId: e.eventId, eventCreatedAt: eventAt, triggerActorId: e.actorId, objectAuthorId: current.authorId!, repositoryId: bound.repositoryId, objectId: current.objectId,
    eventPayloadHash: githubReadHash('dsh-github-creation-event-v1', e), currentSnapshotHash: current.contentHash, representationTag: current.representationTag });
}
export function compareGithubRepresentations(previousInput: unknown, currentInput: unknown): 'same' | 'conflict' | 'incomparable' | 'different_object' {
  const previous = localObject(captureGithubReadData(previousInput)), current = localObject(captureGithubReadData(currentInput));
  if (previous.repositoryId !== current.repositoryId || previous.objectKind !== current.objectKind || previous.objectId !== current.objectId || previous.nodeId !== current.nodeId || previous.issueId !== current.issueId || previous.issueNodeId !== current.issueNodeId) return 'different_object';
  if (previous.representationTag !== current.representationTag) return 'incomparable';
  return previous.contentHash === current.contentHash ? 'same' : 'conflict';
}
