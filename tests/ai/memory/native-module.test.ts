import BuiltinDatabase from '../../../src/utils/builtin-sqlite.js';
import { describe, expect, it } from 'vitest';

describe('runtime built-in SQLite (no external addon)', () => {
  it('can create and query an in-memory database', () => {
    const Database = BuiltinDatabase;
    const db = new Database(':memory:');

    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO test (name) VALUES ('hello')");

    const row = db.prepare('SELECT * FROM test WHERE id = 1').get() as { id: number; name: string };
    expect(row.id).toBe(1);
    expect(row.name).toBe('hello');

    db.close();
  });

  it('handles prepared statements correctly', () => {
    const Database = BuiltinDatabase;
    const db = new Database(':memory:');

    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');

    const insert = db.prepare('INSERT INTO items (value) VALUES (?)');
    insert.run('a');
    insert.run('b');
    insert.run('c');

    const count = (db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number }).n;
    expect(count).toBe(3);

    const all = db.prepare('SELECT value FROM items ORDER BY id').all() as Array<{ value: string }>;
    expect(all.map(r => r.value)).toEqual(['a', 'b', 'c']);

    db.close();
  });
});
