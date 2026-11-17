import BuiltinDatabase from '../../utils/builtin-sqlite.js';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../../utils/builtin-sqlite.js';
import { VERIFICATION_BUDGET } from './protocol.js';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';

const privateFreeze=Object.freeze;
const privateCreate=Object.create,privateApply=Reflect.apply,privateDescriptor=Object.getOwnPropertyDescriptor,privatePrototype=Object.getPrototypeOf;
const NativeDatabase=BuiltinDatabase,originalDatabasePrototype=DatabaseSync.prototype;
const originalNativePrepare=DatabaseSync.prototype.prepare;
const originalNativeStatements=privateFreeze(Object.fromEntries([['raw','setReturnArrays'],['get','get'],['all','all'],['columns','columns'],['safeIntegers','setReadBigInts']].map(([key,nativeKey])=>[key!,privateDescriptor(StatementSync.prototype,nativeKey!)!.value as Function])));
const nativeConnections=new WeakMap<Database,Readonly<{receiver:object;prepare:Function;open:Function;inTransaction:Function;statement:Readonly<Record<string,Function>>;databasePrototype:object;statementPrototype:object;prototypes:readonly {target:object;prototype:object|null}[];fingerprints:readonly Readonly<{target:object;key:PropertyKey;descriptor:PropertyDescriptor|undefined}>[] }>>();
/** Only the actual no-verbose private opener mints this code/data-access context. No authority is supplied. */
export function readPrivateDatabaseNativeAccess(db:Database){return nativeConnections.get(db);}

/** Bounded private storage, not evidence that its enclosing OS identity is qualified. */
export function openPrivateVerificationDatabase(inputRoot: string): Database {
  mkdirSync(inputRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(inputRoot).isSymbolicLink() || !lstatSync(inputRoot).isDirectory()) throw Error('verification_database_path');
  const root = realpathSync(inputRoot), path = join(root, 'authority.sqlite');
  for (const name of [path, path + '-journal', path + '-wal', path + '-shm']) {
    if (existsSync(name) && (lstatSync(name).isSymbolicLink() || !lstatSync(name).isFile() || lstatSync(name).nlink !== 1)) throw Error('verification_database_path');
  }
  if (existsSync(path + '-wal') || existsSync(path + '-shm')) throw Error('verification_database_wal');
  const options=privateCreate(null);options.timeout=0;options.verbose=null;options.nativeBinding=null;
  const db = new NativeDatabase(path, options);
  const databasePrototype=privatePrototype(db),nativePrototype=originalDatabasePrototype;
  const prepare=originalNativePrepare;
  const probe=privateApply(prepare,db,['SELECT 1']),statementPrototype=privatePrototype(probe);
  const statement=originalNativeStatements;
  const fingerprints:Array<{target:object;key:PropertyKey;descriptor:PropertyDescriptor|undefined}>=[];
  const targets=[db,databasePrototype,nativePrototype,statementPrototype];
  for(const target of targets)for(const key of new Set([...Reflect.ownKeys(target),'prepare','pragma','open','close','exec','isOpen','isTransaction']))fingerprints.push({target,key,descriptor:privateDescriptor(target,key)});
  const access=privateFreeze({receiver:db,prepare,open:privateDescriptor(db,'isOpen')!.get!,inTransaction:privateDescriptor(db,'isTransaction')!.get!,statement:privateFreeze(statement),databasePrototype,statementPrototype,prototypes:privateFreeze(targets.map(target=>privateFreeze({target,prototype:privatePrototype(target)}))),fingerprints:privateFreeze(fingerprints.map(entry=>privateFreeze({...entry,descriptor:entry.descriptor?privateFreeze({...entry.descriptor}):undefined})))});
  try {
    db.pragma('journal_mode=DELETE'); db.pragma('synchronous=FULL');
    const max = Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / (db.pragma('page_size', { simple: true }) as number));
    if ((db.pragma(`max_page_count=${max}`, { simple: true }) as number) > max || (db.pragma('page_count', { simple: true }) as number) > max) throw Error('verification_capacity_exhausted');
    syncDirectoryTreeStrict(root);nativeConnections.set(db,access); return db;
  } catch (error) { db.close(); throw error; }
}
