import type { DatabaseSync } from 'node:sqlite';

/** Node 22.14 lacks DatabaseSync.isTransaction. A deferred BEGIN probe never
 * changes rows; an existing transaction/savepoint rejects it without alteration.
 * All other errors remain errors, rather than being mistaken for an idle DB. */
export function isSqliteTransactionActive(
  db: Pick<DatabaseSync, 'exec'> & { readonly isTransaction?: boolean },
): boolean {
  const nativeState = db.isTransaction;
  if (typeof nativeState === 'boolean') return nativeState;
  try {
    db.exec('BEGIN');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR'
      && 'errcode' in error && error.errcode === 1
      && error.message === 'cannot start a transaction within a transaction') return true;
    throw error;
  }
  db.exec('ROLLBACK');
  return false;
}
