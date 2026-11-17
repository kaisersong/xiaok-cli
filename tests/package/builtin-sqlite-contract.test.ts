import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Database from '../../src/utils/builtin-sqlite.js';
it('ships only the built-in SQLite driver in both product dependency graphs',()=>{
 for(const prefix of ['','desktop/']){
  const manifest=JSON.parse(readFileSync(resolve(prefix+'package.json'),'utf8')),lock=JSON.parse(readFileSync(resolve(prefix+'package-lock.json'),'utf8'));
  expect(manifest.name).toBe(prefix?'xiaok-desktop':'xiaokcode');
  expect(manifest.dependencies?.['better-sqlite3']).toBeUndefined();expect(manifest.devDependencies?.['@types/better-sqlite3']).toBeUndefined();
  expect(Object.keys(lock.packages).filter(key=>/(^|\/)node_modules\/(?:@types\/)?better-sqlite3$/.test(key))).toEqual([]);
 }
 const db=new Database(':memory:');try{expect(db).toBeInstanceOf(DatabaseSync);expect(db.prepare('SELECT sqlite_version() AS version').get()).toHaveProperty('version');}finally{db.close();}
});
