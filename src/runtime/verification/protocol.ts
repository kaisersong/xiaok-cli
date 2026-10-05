import { createHash } from 'node:crypto';

/** Internal controller protocol. Parsing or possession of a DTO never grants authority. */
export interface VerificationDependency {
  kind?: 'inherited'; originOwner?: {profileId:string;ownerKind:VerificationTuple['ownerKind'];ownerId:string}; originalObligationId?:string;
  obligationId: string; predicateId: string; predicateVersion: string; definitionHash: string;
  activeAttemptId: string; attemptEpoch: number; sourceRunId: string; runNonce: string;
  subjectId: string; contentRoot: string; coreId: string; coreHash: string; coreFinalRevision: number;
  proofId: string; proofHash: string; proofRevision: number; requiredScopeId: string; scopeRevision: number; invalidationEpoch: number;
}
/** A direct identifier can never alias an inherited identity, regardless of its text. */
export function verificationDependencyKey(value: VerificationDependency): string {
  return canonicalVerificationJson(value.kind === 'inherited'
    ? ['inherited', value.originOwner, value.originalObligationId] : ['direct', value.obligationId]);
}
export function compareVerificationDependencies(a:VerificationDependency,b:VerificationDependency):number {
  const x=verificationDependencyKey(a),y=verificationDependencyKey(b);return x<y?-1:x>y?1:0;
}
export interface VerificationTuple {
  schemaVersion: 1; profileId: string; ownerKind: 'task' | 'intent' | 'goal' | 'loop' | 'project' | 'kswarm'; ownerId: string;
  migrationEpoch: number; expectedBusinessRevision: number; obligationSetRevision: number; obligationSetHash: string;
  obligations: readonly Readonly<VerificationDependency>[];
  operationId: string; immutablePayloadHash: string; receiverId: string; receiverProtocolVersion: 1;
  receiverInstanceEpoch: number; reservationId: string; nonce: string;
  notBefore: number; validUntil: number; clockDomainId: string; clockQualificationEpoch: number;
}
export const VERIFICATION_BUDGET = Object.freeze({
  profileBytes: 2048 * 1024 ** 2, controlDatabaseBytes: 128 * 1024 ** 2,
  rollbackAndTemporaryBytes: 144 * 1024 ** 2, outboxPayloadBytes: 32 * 1024 ** 2,
  auxiliaryBytes: 16 * 1024 ** 2, maximumCounterOwners: 64, counterOwnerBytes: 4 * 1024 ** 2,
  archiveBytes: 1472 * 1024 ** 2, sessionBytes: 256 * 1024 ** 2, recordBytes: 16 * 1024 ** 2,
  maximumOutboxRecords: 4096, maximumObligationsPerOwner: 256, maximumObligationsPerProfile: 4096, maximumExecutionAttempts: 131072, maximumChecks: 4096, rpcBytes: 1024 ** 2,
});
const dependencyFields = {
  obligationId: 'id', predicateId: 'id', predicateVersion: 'id', definitionHash: 'hash', activeAttemptId: 'id',
  attemptEpoch: 'integer', sourceRunId: 'id', runNonce: 'id', subjectId: 'id', contentRoot: 'hash', coreId: 'id',
  coreHash: 'hash', coreFinalRevision: 'integer', proofId: 'id', proofHash: 'hash', proofRevision: 'integer',
  requiredScopeId: 'id', scopeRevision: 'integer', invalidationEpoch: 'integer',
} as const;
const tupleFields = {
  schemaVersion: 'integer', profileId: 'id', ownerKind: 'id', ownerId: 'id', migrationEpoch: 'integer',
  expectedBusinessRevision: 'integer', obligationSetRevision: 'integer', obligationSetHash: 'hash',
  operationId: 'id', immutablePayloadHash: 'hash', receiverId: 'id', receiverProtocolVersion: 'integer',
  receiverInstanceEpoch: 'integer', reservationId: 'id', nonce: 'id', notBefore: 'integer', validUntil: 'integer',
  clockDomainId: 'id', clockQualificationEpoch: 'integer',
} as const;
function record(input: unknown): Record<string, unknown> {
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if (!('value' in descriptor)) throw Error('verification_accessor_denied');
  return input as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, expected: Record<string, 'id' | 'integer' | 'hash'>, extra: string[] = []): void {
  const keys = Object.keys(input);
  if (keys.length !== Object.keys(expected).length + extra.length || keys.some(k => !Object.hasOwn(expected, k) && !extra.includes(k))) throw Error('verification_tuple_fields');
  for (const [key, kind] of Object.entries(expected)) {
    const value = input[key];
    if (kind === 'integer') {
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw Error('verification_invalid_integer');
    } else if (typeof value !== 'string' || (kind === 'hash' ? !/^[a-f0-9]{64}$/.test(value) : !value.length || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))) throw Error('verification_invalid_string');
  }
}
export function parseVerificationTuple(input: unknown): Readonly<VerificationTuple> {
  const value = record(input); fields(value, tupleFields, ['obligations']);
  if (value.schemaVersion !== 1 || value.receiverProtocolVersion !== 1 || !['task', 'intent', 'goal', 'loop', 'project'].includes(value.ownerKind as string)) throw Error('verification_protocol_version');
  if ((value.validUntil as number) <= (value.notBefore as number)) throw Error('verification_invalid_window');
  if (!Array.isArray(value.obligations) || !value.obligations.length || value.obligations.length > VERIFICATION_BUDGET.maximumObligationsPerOwner) throw Error('verification_obligation_count');
  const obligations = value.obligations.map(raw => {
    const item = record(raw);
    if(item.kind==='inherited'){
      fields(item,{...dependencyFields,kind:'id',originalObligationId:'id'},['originOwner']);
      const origin=record(item.originOwner);fields(origin,{profileId:'id',ownerKind:'id',ownerId:'id'});
      if(!['task','intent','goal','loop','project'].includes(origin.ownerKind as string)||origin.profileId!==value.profileId||item.originalObligationId!==item.obligationId||origin.ownerKind===value.ownerKind&&origin.ownerId===value.ownerId)throw Error('verification_dependency_origin');
      return Object.freeze({...item,originOwner:Object.freeze({...origin})}) as unknown as Readonly<VerificationDependency>;
    }
    fields(item,dependencyFields);return Object.freeze({...item}) as unknown as Readonly<VerificationDependency>;
  });
  obligations.sort(compareVerificationDependencies);
  if (new Set(obligations.map(verificationDependencyKey)).size !== obligations.length) throw Error('verification_duplicate_obligation');
  const result = Object.freeze({ ...value, obligations: Object.freeze(obligations) }) as unknown as Readonly<VerificationTuple>;
  if (Buffer.byteLength(canonicalVerificationJson(result)) > VERIFICATION_BUDGET.rpcBytes) throw Error('verification_rpc_limit');
  return result;
}
export function canonicalVerificationJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalVerificationJson).join(',') + ']';
  const object = record(value);
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalVerificationJson(object[key])).join(',') + '}';
}
export function hashVerificationTuple(value: unknown): string {
  return createHash('sha256').update(canonicalVerificationJson(parseVerificationTuple(value))).digest('hex');
}
const transitions: Record<string, Record<string, readonly string[]>> = {
  attempt: { prepared: ['running', 'unknown', 'cancelled_before_dispatch'], running: ['termination_pending', 'unknown', 'terminal'], termination_pending: ['unknown', 'terminal'], unknown: ['terminal'], terminal: ['superseded'] },
  proof: { pending: ['pass', 'fail', 'unverified'], pass: ['revoked', 'superseded', 'expired'] },
  settlement: { prepared: ['committed', 'aborted'] },
  outbox: { staged: ['ready', 'failed_before_dispatch', 'cancelled'], ready: ['dispatching', 'failed_before_dispatch', 'cancelled'], dispatching: ['receiver_committed', 'delivery_unknown', 'cancelled'], delivery_unknown: ['receiver_committed', 'cancelled'] },
  reservation: { pending: ['commit_authorized', 'cancelled'], commit_authorized: ['consumed', 'cancelled'] },
  revocation: { active: ['revocation_pending'], revocation_pending: ['revoked'] },
  obligation: { registered_unsatisfied: ['satisfied'], satisfied: ['registered_unsatisfied'] },
  receiver: { prepared: ['committed', 'cancelled'] },
};
/** Structural edge check only; service must also enforce source, facts, tuple and revision. */
export function assertVerificationTransition(kind: string, from: string, to: string): void {
  if (!Object.hasOwn(transitions, kind) || !Object.hasOwn(transitions[kind], from) || !transitions[kind][from].includes(to)) throw Error('verification_illegal_transition');
}
