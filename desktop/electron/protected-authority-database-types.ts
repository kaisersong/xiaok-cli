import type {DatabaseSync, StatementSync} from 'node:sqlite';

// The authority owners use this small synchronous surface. These types do not
// confer a Node DatabaseSync brand or permit a caller-supplied database opener.
export type AuthorityStatement = Pick<StatementSync, 'get' | 'all' | 'run' | 'iterate'>;
export interface AuthorityDatabase extends Pick<DatabaseSync, 'exec' | 'function' | 'close'> {
  prepare(sql: string): AuthorityStatement;
  readonly isTransaction: boolean;
}
export interface OriginalAdmissionDatabaseBundle {
  readonly Database: new () => AuthorityDatabase;
  readonly databaseMethods: Readonly<{exec: Function; prepare: Function; function: Function; close: Function}>;
  readonly statementMethods: Readonly<{get: Function; all: Function; run: Function; iterate: Function}>;
  readonly transactionStateGetter: Function;
  readonly closeOwned: () => void;
}
