import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from './protocol.js';

export const MAIN_ROOT_FAMILY_PURPOSE = 'main-root-family-enrollment';
export const MAIN_ROOT_FAMILY_METHODS = Object.freeze([
  'completion.prepare-main-root-family', 'completion.authorize-main-root-family',
  'completion.read-main-root-family', 'completion.recover-main-root-family',
  'completion.cancel-main-root-family',
] as const);
export const MAIN_ROOT_FAMILY_PENDING_NAME = 'main-root-family.pending.json';
const fields = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf, own = Object.hasOwn, freeze = Object.freeze;
const isProxy = types.isProxy, array = Array.isArray, integer = Number.isSafeInteger;
const plain = Object.prototype, arrayPrototype = Array.prototype;
const phases = ['prepared', 'authorizing', 'authorized', 'failed', 'unknown', 'cancel_requested', 'cancelled'];
const targetRows = [
  {family: 'admission', scopeRule: 'core-admission-v1'},
  {family: 'budget', scopeRule: 'core-budget-worker-v1'},
  {family: 'kswarm', scopeRule: 'producer-unresolved'},
  {family: 'broker', scopeRule: 'producer-unresolved'},
] as const;

function fail(): never { throw Error('main_root_enrollment_record'); }
function object(raw: unknown, expected: readonly string[]): Record<string, any> {
  if (!raw || typeof raw !== 'object' || isProxy(raw) || array(raw)) fail();
  const proto = prototype(raw);
  if (proto !== plain && proto !== null) fail();
  const names = fields(raw);
  if (names.length !== expected.length) fail();
  const result: Record<string, any> = Object.create(null);
  for (let i = 0; i < names.length; i++) {
    const key = names[i]!;
    if (typeof key !== 'string' || !expected.includes(key)) fail();
    const row = descriptor(raw, key);
    if (!row || !own(row, 'value')) fail();
    result[key] = row.value;
  }
  return result;
}
function text(raw: unknown): asserts raw is string {
  if (typeof raw !== 'string' || raw.length < 1 || Buffer.byteLength(raw) > 160 || /[\x00-\x1f\x7f]/.test(raw)) fail();
}
function uint(raw: unknown, minimum = 0): asserts raw is number {
  if (!integer(raw) || (raw as number) < minimum || (raw as number) > 0xfffffffe) fail();
}
function hash(raw: unknown): asserts raw is string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) fail();
}
export interface MainRootFamilyPrincipal {
  readonly uid: number; readonly gid: number; readonly auditSessionId: number; readonly accountGeneration: string;
}
export function parseMainRootFamilyPrincipal(raw: unknown): Readonly<MainRootFamilyPrincipal> {
  const p = object(raw, ['uid', 'gid', 'auditSessionId', 'accountGeneration']);
  uint(p.uid, 1); uint(p.gid); uint(p.auditSessionId, 1);
  if (typeof p.accountGeneration !== 'string' || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(p.accountGeneration)) fail();
  return freeze(p) as Readonly<MainRootFamilyPrincipal>;
}
export interface MainRootFamilyReview {
  readonly version: 1; readonly purpose: typeof MAIN_ROOT_FAMILY_PURPOSE;
  /** Consent to prepare a request, never authority to create a pool or fence a writer. */
  readonly authorizationScope: 'pending-only';
  readonly authorityId: string; readonly operationId: string; readonly challengeId: string; readonly profileId: string;
  readonly principal: Readonly<MainRootFamilyPrincipal>;
  readonly deadline: Readonly<{domainId: string; qualificationEpoch: number; notBefore: number; validUntil: number}>;
  readonly targets: readonly Readonly<{family: string; scopeRule: string}>[];
}
export function parseMainRootFamilyEnrollmentReview(raw: unknown): Readonly<MainRootFamilyReview> {
  const r = object(raw, ['version', 'purpose', 'authorizationScope', 'authorityId', 'operationId', 'challengeId', 'profileId', 'principal', 'deadline', 'targets']);
  if (r.version !== 1 || r.purpose !== MAIN_ROOT_FAMILY_PURPOSE || r.authorizationScope !== 'pending-only') fail();
  for (const key of ['authorityId', 'operationId', 'challengeId', 'profileId']) text(r[key]);
  r.principal = parseMainRootFamilyPrincipal(r.principal);
  const d = object(r.deadline, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']);
  text(d.domainId); uint(d.qualificationEpoch, 1);
  if (!integer(d.notBefore) || !integer(d.validUntil) || d.notBefore < 0 || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300001) fail();
  r.deadline = freeze(d);
  const targets = r.targets;
  if (isProxy(targets) || !array(targets) || prototype(targets) !== arrayPrototype || targets.length !== 4 || fields(targets).length !== 5) fail();
  const copied: Readonly<{family: string; scopeRule: string}>[] = [];
  for (let i = 0; i < 4; i++) {
    const row = descriptor(targets, String(i));
    if (!row || !own(row, 'value')) fail();
    const target = object(row.value, ['family', 'scopeRule']), expected = targetRows[i]!;
    if (target.family !== expected.family || target.scopeRule !== expected.scopeRule) fail();
    copied.push(freeze(target) as Readonly<{family: string; scopeRule: string}>);
  }
  r.targets = freeze(copied);
  const result = freeze(r) as Readonly<MainRootFamilyReview>;
  if (Buffer.byteLength(json(result)) > 4096) fail();
  return result;
}
export function mainRootFamilyTargets(): MainRootFamilyReview['targets'] {
  return freeze(targetRows.map(row => freeze({...row})));
}
export interface MainRootFamilyEnrollmentRecord {
  readonly version: 1; readonly purpose: typeof MAIN_ROOT_FAMILY_PURPOSE; readonly state: 'pending';
  readonly phase: 'prepared' | 'authorizing' | 'authorized' | 'failed' | 'unknown' | 'cancel_requested' | 'cancelled';
  readonly boot: string; readonly requestId: string; readonly review: Readonly<MainRootFamilyReview>;
  readonly approval?: Readonly<{uid: number; auditSessionId: number; reviewHash: string}>;
}
export function parseMainRootFamilyEnrollmentRecord(raw: unknown): Readonly<MainRootFamilyEnrollmentRecord> {
  if (!raw || typeof raw !== 'object' || isProxy(raw)) fail();
  const hasApproval = own(raw, 'approval');
  const r = object(raw, ['version', 'purpose', 'state', 'phase', 'boot', 'requestId', 'review', ...(hasApproval ? ['approval'] : [])]);
  if (r.version !== 1 || r.purpose !== MAIN_ROOT_FAMILY_PURPOSE || r.state !== 'pending' || !phases.includes(r.phase)) fail();
  text(r.boot); text(r.requestId); r.review = parseMainRootFamilyEnrollmentReview(r.review);
  if (hasApproval) {
    const a = object(r.approval, ['uid', 'auditSessionId', 'reviewHash']);
    uint(a.uid, 1); uint(a.auditSessionId, 1); hash(a.reviewHash);
    if (a.uid !== r.review.principal.uid || a.auditSessionId !== r.review.principal.auditSessionId || a.reviewHash !== mainRootFamilyReviewHash(r.review)) fail();
    r.approval = freeze(a);
  }
  if (r.phase === 'authorized' && !hasApproval || ['prepared', 'authorizing'].includes(r.phase) && hasApproval) fail();
  if (Buffer.byteLength(json(r)) > 4096) fail();
  return freeze(r) as Readonly<MainRootFamilyEnrollmentRecord>;
}
export function mainRootFamilyReviewBytes(review: Readonly<MainRootFamilyReview>): Buffer {
  const parsed = parseMainRootFamilyEnrollmentReview(review);
  return Buffer.from(json(parsed).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
}
export function mainRootFamilyReviewHash(review: Readonly<MainRootFamilyReview>): string {
  return createHash('sha256').update(mainRootFamilyReviewBytes(review)).digest('hex');
}
export function mainRootFamilyIntentKey(record: Readonly<MainRootFamilyEnrollmentRecord>): string {
  const r = parseMainRootFamilyEnrollmentRecord(record), p = r.review.principal;
  return 'main-root-family:' + createHash('sha256').update(json({authorityId: r.review.authorityId, uid: p.uid, accountGeneration: p.accountGeneration, requestId: r.requestId})).digest('hex');
}
export function mainRootFamilyLogicalKey(authorityId: string, principal: Readonly<MainRootFamilyPrincipal>): string {
  text(authorityId); const p = parseMainRootFamilyPrincipal(principal);
  return json({purpose: MAIN_ROOT_FAMILY_PURPOSE, authorityId, uid: p.uid, accountGeneration: p.accountGeneration});
}
export function parseMainRootFamilyRequest(raw: unknown, mode: 'prepare' | 'read' | 'mutation'): Record<string, any> {
  if (!raw || typeof raw !== 'object' || isProxy(raw)) throw Error('main_root_enrollment_request');
  if (mode !== 'read') {
    const source = descriptor(raw, 'requestSource');
    if (!source || !own(source, 'value') || source.value !== 'user') throw Error('main_root_enrollment_source');
  }
  try {
    const r = object(raw, mode === 'prepare' ? ['requestId', 'requestSource'] : mode === 'read' ? ['operationId'] : ['operationId', 'requestSource']);
    text(mode === 'prepare' ? r.requestId : r.operationId);
    return freeze(r);
  } catch { throw Error('main_root_enrollment_request'); }
}
