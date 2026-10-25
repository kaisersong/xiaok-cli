import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { assertVerificationDatabaseBudget, runVerificationTransaction, isVerificationHeadroomNotReady } from '../../../src/runtime/verification/storage-budget.js';

describe('actual persisted verification bytes and FULL classification', () => {
  it('counts tuple/reply metadata, not just payload or number of rows', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'); const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE publication_journal(tuple_json TEXT,reply_json TEXT,state_json TEXT,challenge TEXT);');
      db.prepare('INSERT INTO publication_journal VALUES(?,?,?,?)').run('x'.repeat(2048), 'y'.repeat(2048), '{}', 'z'.repeat(64));
      expect(() => assertVerificationDatabaseBudget(db, { additionalBytes: 128, limitBytes: 4096 })).toThrow('verification_control_budget');
    } finally { db.close(); }
  });
  it('real SQLite FULL rolls back and is reported as capacity, never memory success', () => {
    const root = mkdtempSync(join(tmpdir(), 'verification-full-'));
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(join(root, 'authority.sqlite'));
    try {
      db.exec('CREATE TABLE sample(value BLOB)'); db.pragma('max_page_count=4');
      expect(() => runVerificationTransaction(db, () => db.prepare('INSERT INTO sample VALUES(?)').run(Buffer.alloc(65536)))).toThrow('verification_capacity_exhausted');
      expect(db.prepare('SELECT COUNT(*) n FROM sample').get().n).toBe(0);
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
it.each([
 ['material_authority_challenges','record_json TEXT,state TEXT,secret_hash TEXT'],
 ['broker_staging_intents','record_json TEXT,state TEXT,scope_digest TEXT'],
 ['docker_runner_resources','resources_json TEXT'],
 ['goal_application_requests','request_id TEXT,principal_json TEXT,binding_json TEXT,challenge_id TEXT'],
 ['goal_application_challenges','id TEXT,principal TEXT,boot TEXT,state TEXT,review_json TEXT,transition_id TEXT'],
])('reserves terminal headroom for durable %s instead of treating resource intents as free metadata',(table,columns)=>{
 const Database=createRequire(import.meta.url)('better-sqlite3'),db=new Database(':memory:');
 try{
  db.exec(`CREATE TABLE ${table}(${columns})`);
  const column=columns.split(' ')[0];
  const insert=db.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`);
  db.transaction(()=>{for(let i=0;i<64;i++)insert.run('{}');})();
  expect(()=>assertVerificationDatabaseBudget(db,{additionalBytes:0,limitBytes:128*1024})).toThrow('verification_control_budget');
 }finally{db.close();}
});

it('counts the full original registration in Goal session enrollment receipts',()=>{
 const Database=createRequire(import.meta.url)('better-sqlite3'),db=new Database(':memory:');
 try{db.exec('CREATE TABLE owner_enrollment_goal_sessions(logical_owner_key TEXT,owner_key TEXT,goal_session_id TEXT,registration_json TEXT)');
 db.prepare('INSERT INTO owner_enrollment_goal_sessions VALUES(?,?,?,?)').run('logical','owner','session','x'.repeat(2048));
 expect(()=>assertVerificationDatabaseBudget(db,{additionalBytes:1,limitBytes:2048})).toThrow('verification_control_budget');
 }finally{db.close();}
});

it.each([
 ['owner_enrollment_intent_contracts','logical_owner_key TEXT,owner_key TEXT,contract_json TEXT,registration_json TEXT','contract_json'],
 ['owner_enrollment_intent_contracts','logical_owner_key TEXT,owner_key TEXT,contract_json TEXT,registration_json TEXT','registration_json'],
 ['owner_enrollment_intents','logical_owner_key TEXT,registration_json TEXT,intent_contract_json TEXT','intent_contract_json'],
 ['owner_enrollment_loop_subjects','logical_owner_key TEXT,owner_key TEXT,subject_json TEXT,registration_json TEXT','subject_json'],
 ['owner_enrollment_loop_subjects','logical_owner_key TEXT,owner_key TEXT,subject_json TEXT,registration_json TEXT','registration_json'],
 ['owner_enrollment_intents','logical_owner_key TEXT,registration_json TEXT,loop_subject_json TEXT','loop_subject_json'],
])('counts persisted Loop enrollment bytes independently of the allocated-page fallback: %s %s %s',(table,columns,column)=>{
 const Database=createRequire(import.meta.url)('better-sqlite3'),db=new Database(':memory:');
 try{
  db.exec(`CREATE TABLE ${table}(${columns})`);db.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`).run('汉'.repeat(8192));
  // Exercise the actual SQL census independently of its second physical-page
  // bound. A real byte-valued SQLite column is read by the production function.
  const pragma=db.pragma.bind(db);db.pragma=(query:string,...args:unknown[])=>query==='page_count'?1:pragma(query,...args);
  expect(()=>assertVerificationDatabaseBudget(db,{additionalBytes:0,limitBytes:16384})).toThrow('verification_control_budget');
 }finally{db.close();}
});

describe('actual SQLite physical cap admission', () => {
  it('admits an actual empty database with zero allocated pages', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      expect(db.pragma('page_count', {simple: true})).toBe(0);
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 0})).not.toThrow();
    } finally { db.close(); }
  });
  it('uses the real smaller page cap at the exact original budget boundary before a writer runs', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE actual_writer(value BLOB)');
      expect(db.pragma('page_size', {simple: true})).toBe(4096);
      expect(db.pragma('page_count', {simple: true})).toBe(2);
      expect(db.pragma('max_page_count=4', {simple: true})).toBe(4);
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 2048})).not.toThrow();
      let writes = 0;
      expect(() => runVerificationTransaction(db, () => {
        assertVerificationDatabaseBudget(db, {additionalBytes: 2049});
        writes++;
        db.prepare('INSERT INTO actual_writer VALUES(?)').run(Buffer.alloc(1));
      })).toThrow('verification_capacity_exhausted');
      expect(writes).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM actual_writer').get()).toEqual({n: 0});
    } finally { db.close(); }
  });
  it('retains a smaller explicit logical limit even when the real physical cap allows more', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE actual_writer(value BLOB)');
      db.pragma('max_page_count=8');
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 0, limitBytes: 12288})).not.toThrow();
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 1, limitBytes: 12288})).toThrow('verification_control_budget');
    } finally { db.close(); }
  });
  it('classifies a count above the captured maximum as invalid geometry before physical exhaustion', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE actual_writer(value BLOB)');
      expect(db.pragma('max_page_count=4', {simple: true})).toBe(4);
      const original = db.pragma.bind(db);
      const spy = vi.spyOn(db, 'pragma').mockImplementation((query: unknown, ...args: unknown[]) => query === 'page_count' ? 5 : original(query, ...args));
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 0})).toThrow('verification_control_budget');
      spy.mockRestore();
    } finally { db.close(); }
  });
  it('reads each geometry pragma once and uses those exact values', () => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE actual_writer(value BLOB)');
      const original = db.pragma.bind(db), seen: string[] = [];
      const spy = vi.spyOn(db, 'pragma').mockImplementation((query: unknown, ...args: unknown[]) => {
        seen.push(query as string);
        return original(query, ...args);
      });
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 0})).not.toThrow();
      expect(seen).toEqual(['page_count', 'page_size', 'max_page_count']);
      spy.mockRestore();
    } finally { db.close(); }
  });
  it.each([
    ['page_count', -1], ['page_count', .5], ['page_count', Number.MAX_SAFE_INTEGER + 1],
    ['page_size', 0], ['page_size', -1], ['page_size', .5], ['page_size', Number.MAX_SAFE_INTEGER + 1],
    ['max_page_count', 0], ['max_page_count', -1], ['max_page_count', .5], ['max_page_count', Number.MAX_SAFE_INTEGER + 1],
    ['page_count', 4294967295],
    ['page_size', Number.MAX_SAFE_INTEGER],
  ])('rejects invalid actual geometry fault %s=%s', (name, value) => {
    const Database = createRequire(import.meta.url)('better-sqlite3'), db = new Database(':memory:');
    try {
      const original = db.pragma.bind(db);
      const spy = vi.spyOn(db, 'pragma').mockImplementation((query: unknown, ...args: unknown[]) => query === name ? value : original(query, ...args));
      expect(() => assertVerificationDatabaseBudget(db, {additionalBytes: 0})).toThrow('verification_control_budget');
      spy.mockRestore();
    } finally { db.close(); }
  });
});

it.each(['plain-forged','actual-native'] as const)('brands only actual native SQLite FULL after actual own transaction rollback: %s',mode=>{
 const Database=createRequire(import.meta.url)('better-sqlite3'),db=new Database(':memory:');try{db.exec('CREATE TABLE native_full(value BLOB)');db.pragma('max_page_count=4');let cause:unknown;
 try{runVerificationTransaction(db,()=>{if(mode==='plain-forged'){db.prepare('INSERT INTO native_full VALUES(?)').run(Buffer.from('actual rollback row'));throw Object.assign(Error('ordinary callback failure'),{name:'SqliteError',code:'SQLITE_FULL'});}db.prepare('INSERT INTO native_full VALUES(?)').run(Buffer.alloc(65536));});}catch(error){cause=error;}
 expect(cause).toBeInstanceOf(Error);expect(db.inTransaction).toBe(false);expect(db.prepare('SELECT COUNT(*) n FROM native_full').get()).toEqual({n:0});expect(isVerificationHeadroomNotReady(cause,db)).toBe(mode==='actual-native');if(mode==='actual-native')expect((cause as Error).cause).toBeInstanceOf(Database.SqliteError);else expect((cause as Error).cause).not.toBeInstanceOf(Database.SqliteError);
 }finally{db.close();}
});
