import { createHash } from 'node:crypto';
import type { SessionExecutionLease } from './execution-authority.js';
import type { PersistedSessionSnapshot } from './store.js';
export interface SessionMigrationInput {
  sessionId: string; expectedSnapshotHash: string; expectedStoreRevision: number;
  migrationId: string; targetAuthorityId: string; targetSessionId: string;
  migrationEpoch: number; importReceiptHash: string; lease: SessionExecutionLease;
}
export type SessionMigrationMarker = Omit<SessionMigrationInput, 'lease'> & { version: 1 };
const fields = ['version','sessionId','expectedSnapshotHash','expectedStoreRevision','migrationId','targetAuthorityId','targetSessionId','migrationEpoch','importReceiptHash'];
export function captureMigrationMarker(value: unknown): SessionMigrationMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('session_migration_invalid');
  const r = value as Record<string,unknown>;
  if (Object.keys(r).length !== fields.length || fields.some(k=>!Object.hasOwn(r,k)) || Object.values(Object.getOwnPropertyDescriptors(r)).some(d=>!('value'in d))
    || r.version !== 1 || !['sessionId','migrationId','targetAuthorityId','targetSessionId'].every(k=>typeof r[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(r[k] as string))
    || !['expectedSnapshotHash','importReceiptHash'].every(k=>typeof r[k]==='string'&&/^[a-f0-9]{64}$/.test(r[k] as string))
    || !Number.isSafeInteger(r.expectedStoreRevision) || (r.expectedStoreRevision as number)<0 || !Number.isSafeInteger(r.migrationEpoch) || (r.migrationEpoch as number)<1) throw Error('session_migration_invalid');
  return Object.freeze(structuredClone(r)) as unknown as SessionMigrationMarker;
}
export function migrationMarkerFromInput(input: SessionMigrationInput): SessionMigrationMarker {
  const { lease: _lease, ...facts } = input; return captureMigrationMarker({ version: 1, ...facts });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>[k,canonical((value as Record<string,unknown>)[k])]));
  return value;
}
/** Canonical full durable snapshot; distinct from provider history digest. */
export function computeSessionSnapshotHash(snapshot: PersistedSessionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}
export function freezeMigrationSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot {
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
  const clone=structuredClone(snapshot);freeze(clone);return clone;
}
