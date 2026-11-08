import {DatabaseSync} from 'node:sqlite';

const descriptor = Object.getOwnPropertyDescriptor;
const prototypeTransaction = descriptor(DatabaseSync.prototype, 'isTransaction');
const nativeClose = DatabaseSync.prototype.close;
const apply = Reflect.apply, NativeError = Error;
type Reason = 'loop_database_metadata_transaction' | 'loop_native_migration_outer_transaction';
// No caller can clear uncertainty by reporting a state. Keep the original DB
// and raw failure until the fixed negative close actually returns for this DB.
let heldFailure: {db: DatabaseSync; raw: unknown; error: Error} | undefined;

export function assertLoopSQLiteReady(): void {
  if (heldFailure) throw heldFailure.error;
}
function hold(db: DatabaseSync, reason: Reason, raw: unknown): never {
  if (!heldFailure) heldFailure = {db, raw, error: new NativeError(reason, {cause: raw})};
  throw heldFailure.error;
}

export function assertLoopSQLiteAutocommit(db: DatabaseSync, reason: Reason): void {
  assertLoopSQLiteReady();
  // Current Node exposes this as a nonconfigurable own accessor, not a
  // prototype accessor. The DB itself came from the fixed owner connection.
  const transactionDescriptor = descriptor(db, 'isTransaction') ?? prototypeTransaction;
  const nativeTransaction = transactionDescriptor?.get;
  if (transactionDescriptor !== undefined) {
    let active: unknown;
    try {
      if (typeof nativeTransaction !== 'function') throw new NativeError('loop_sqlite_transaction_state');
      active = apply(nativeTransaction, db, []);
    } catch (raw) { hold(db, reason, raw); }
    if (active === false) return;
    if (active === true) throw new NativeError(reason);
    hold(db, reason, new NativeError('loop_sqlite_transaction_state'));
  }
  // Node22.14 has no transaction getter. This changes only the connection flag;
  // it is not a read-only API and is not retained as future transaction proof.
  // A failed BEGIN may already have entered: never roll back an unknown owner.
  try { db.exec('BEGIN DEFERRED'); } catch (raw) { hold(db, reason, raw); }
  try { db.exec('ROLLBACK'); } catch (raw) { hold(db, reason, raw); }
  assertLoopSQLiteReady();
}

export function closeLoopSQLiteDatabase(db: DatabaseSync): void {
  // Negative cleanup must remain reachable while the positive fuse is closed.
  apply(nativeClose, db, []);
  if (heldFailure?.db === db) heldFailure = undefined;
}
