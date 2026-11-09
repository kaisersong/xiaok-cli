'use strict';
// This fixed adapter supplies argument/row/iterator compatibility, never IO authority.
const {types: {isProxy}} = require('node:util');
const native = require('./protected_sqlite.node');
const apply = Reflect.apply, descriptors = Object.getOwnPropertyDescriptors,
      define = Object.defineProperty;
const create = Object.create, freeze = Object.freeze, setPrototype = Object.setPrototypeOf;
const keys = Reflect.ownKeys, iteratorSymbol = Symbol.iterator, hasOwn = Object.hasOwn,
      map = Array.prototype.map;
const wrapped = new WeakMap(), get = WeakMap.prototype.get, set = WeakMap.prototype.set;
const NativeError = Error, NativeTypeError = TypeError, assertCore = native.assertOriginalNamespace;
function put(o, k, v) {
  define(o, k, {__proto__: null, value: v, enumerable: true, writable: false, configurable: false});
}
function row(raw) {
  if (raw === undefined) return raw;
  const out = create(null), ds = descriptors(raw);
  const names = keys(ds);
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    const d = ds[k];
    if (!hasOwn(d, 'value')) throw NativeError('PROTECTED_SQLITE_RESULT_ACCESSOR');
    put(out, k, d.value);
  }
  return out;
}
exports.wrapOriginalProtectedSQLiteNamespace = function(core) {
  apply(assertCore, native, [core]);
  const old = apply(get, wrapped, [core]);
  if (old) return old;
  const dm = core.databaseMethods, sm = core.statementMethods, tx = core.transactionStateGetter,
        close = core.closeOwned;
  class Database extends core.Database {
    constructor(...args) {
      if (args.length) throw NativeTypeError('protected database accepts no path or options');
      super();
      define(
          this, 'isTransaction',
          {__proto__: null, get: tx, enumerable: false, configurable: false});
    }
    prepare(sql) {
      const value = apply(dm.prepare, this, [sql]);
      setPrototype(value, Statement.prototype);
      return value;
    }
    function(name, options, callback) {
      apply(dm.assertDatabase, this, []);
      let deterministic = false;
      if (typeof options === 'function' && callback === undefined) {
        callback = options;
        options = undefined;
      }
      if (isProxy(callback) || typeof callback !== 'function')
        throw NativeTypeError('original synchronous callback required');
      if (options !== undefined) {
        if (options === null || typeof options !== 'object' || isProxy(options))
          throw NativeTypeError('closed UDF options required');
        const ds = descriptors(options);
        const names = keys(ds);
        for (let i = 0; i < names.length; i++) {
          const k = names[i];
          if (k !== 'deterministic' || !hasOwn(ds[k], 'value') || typeof ds[k].value !== 'boolean')
            throw NativeTypeError('closed UDF options required');
          deterministic = ds[k].value;
        }
      }
      return apply(dm.registerFunction, this, [name, deterministic, callback]);
    }
  }
  class Statement extends core.Statement {
    get(...args) {
      return row(apply(sm.get, this, args));
    }
    all(...args) {
      return apply(map, apply(sm.all, this, args), [row]);
    }
    run(...args) {
      return row(apply(sm.run, this, args));
    }
    iterate(...args) {
      apply(sm.assertStatement, this, []);
      const cursor = apply(sm.beginIterator, this, args), next = cursor.next, end = cursor.return;
      const iterator = create(null);
      put(iterator, 'next', () => {
        const v = apply(next, cursor, []);
        return {done: v.done, value: v.done ? null : row(v.value)};
      });
      put(iterator, 'return', () => apply(end, cursor, []));
      put(iterator, 'throw', value => {
        apply(end, cursor, []);
        throw value;
      });
      put(iterator, iteratorSymbol, () => iterator);
      return freeze(iterator);
    }
  }
  const prototypes =
      [Database.prototype, Statement.prototype, core.Database.prototype, core.Statement.prototype];
  for (let i = 0; i < prototypes.length; i++) freeze(prototypes[i]);
  freeze(Database);
  freeze(Statement);
  const api = create(null), databaseMethods = create(null), statementMethods = create(null);
  const dbKeys = ['exec', 'prepare', 'function', 'close'];
  for (let i = 0; i < dbKeys.length; i++) {
    const k = dbKeys[i];
    put(databaseMethods, k, Database.prototype[k]);
  }
  const stmtKeys = ['get', 'all', 'run', 'iterate', 'setReadBigInts'];
  for (let i = 0; i < stmtKeys.length; i++) {
    const k = stmtKeys[i];
    put(statementMethods, k, Statement.prototype[k]);
  }
  put(api, 'Database', Database);
  put(api, 'Statement', Statement);
  put(api, 'databaseMethods', freeze(databaseMethods));
  put(api, 'statementMethods', freeze(statementMethods));
  put(api, 'transactionStateGetter', tx);
  put(api, 'closeOwned', () => apply(close, core, []));
  freeze(api);
  apply(set, wrapped, [core, api]);
  return api;
};

/** Passive exact membership only; historical identity is no SQL/current grant. */
exports.readOriginalProtectedSQLiteNamespace = function(api, core) {
  apply(assertCore, native, [core]);
  const original = apply(get, wrapped, [core]);
  if (!original || original !== api) throw NativeError('PROTECTED_SQLITE_NAMESPACE_REQUIRED');
  return original;
};
