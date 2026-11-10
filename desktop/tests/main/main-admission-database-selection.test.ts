// @vitest-environment node
// Actual Store SQL with an instrumented non-Node receiver. This does not prove
// Native namespace provenance, file protection, migration or production gates.
import {expect, it, vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import type {OriginalAdmissionDatabaseBundle} from '../../electron/protected-authority-database-types.js';
const state = vi.hoisted(() => ({bundle: undefined as object | undefined}));
vi.mock('../../electron/main-dsh-bootstrap-authority.js', async importOriginal => ({
  ...await importOriginal<object>(),
  readOriginalMainDshAdmissionDatabase: () => state.bundle ?? null,
}));

it('the original Store uses the fixed adapter constructor and captured methods for non-Node database receivers', async () => {
  let constructed = 0, functions = 0, closes = 0, capturedFunctions = 0, capturedCloses = 0;
  const databases = new WeakMap<object, DatabaseSync>();
  const statements = new WeakMap<object, ReturnType<DatabaseSync['prepare']>>();
  class Statement {
    get(...args: any[]) {return statements.get(this)!.get(...args);}
    all(...args: any[]) {return statements.get(this)!.all(...args);}
    run(...args: any[]) {return statements.get(this)!.run(...args);}
    iterate(...args: any[]) {return statements.get(this)!.iterate(...args);}
  }
  class Database {
    declare readonly isTransaction: boolean;
    constructor(...args: unknown[]) {
      expect(args).toHaveLength(0); constructed++;
      const db = new DatabaseSync(':memory:'); databases.set(this, db);
      Object.defineProperty(this, 'isTransaction', {get: () => db.isTransaction, configurable: false});
    }
    exec(sql: string) {databases.get(this)!.exec(sql);}
    prepare(sql: string) {
      const value = new Statement(); statements.set(value, databases.get(this)!.prepare(sql)); return value;
    }
    function(name: string, options: any, callback: any) {
      functions++; databases.get(this)!.function(name, options, callback);
    }
    close() {closes++; databases.get(this)!.close();}
  }
  state.bundle = Object.freeze({Database,
    databaseMethods: Object.freeze({exec: Database.prototype.exec, prepare: Database.prototype.prepare,
      function: function(this: Database, ...args: Parameters<Database['function']>) {
        capturedFunctions++; return Database.prototype.function.apply(this, args);
      }, close: function(this: Database) {capturedCloses++; return Database.prototype.close.call(this);}}),
    statementMethods: Object.freeze({get: Statement.prototype.get, all: Statement.prototype.all,
      run: Statement.prototype.run, iterate: Statement.prototype.iterate}),
    transactionStateGetter: function(this: Database) {return databases.get(this)!.isTransaction;},
    closeOwned() {},
  } satisfies OriginalAdmissionDatabaseBundle);
  let store: import('../../electron/desktop-multi-agent-store.js').DesktopMultiAgentStore | undefined;
  try {
    const {DesktopMultiAgentStore} = await import('../../electron/desktop-multi-agent-store.js');
    store = new DesktopMultiAgentStore(':memory:', {dshAdmissionSource: null, dshUserControlSource: null});
    expect(constructed).toBe(1);
    expect(functions).toBeGreaterThanOrEqual(3);
    expect(capturedFunctions).toBeGreaterThanOrEqual(3);
    expect(store.isClosed()).toBe(false);
    store.close(); expect(closes).toBe(1); expect(capturedCloses).toBe(1);
  } finally {store?.close(); state.bundle = undefined;}
});
