import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,readdirSync,renameSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from '../../src/utils/builtin-sqlite.js';
import {openSqliteParsingCopy,isSqliteParsingCopyCleanupUnknown} from '../../src/utils/sqlite-parsing-copy.js';

it('reads complete original bytes and removes its private parser copy after known native close',()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-parser-source-'));
 try{
  const source=join(root,'source.sqlite'),db=new Database(source);db.exec('CREATE TABLE history(id INTEGER PRIMARY KEY,body TEXT);INSERT INTO history VALUES(1,\'old history\')');db.close();
  const before=new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('xiaok-sqlite-parser-'))),bytes=readFileSync(source),original=Buffer.from(bytes),copy=openSqliteParsingCopy(bytes,true);
  expect(copy.database.prepare('SELECT * FROM history').all()).toEqual([{id:1,body:'old history'}]);
  expect(()=>copy.database.exec('INSERT INTO history VALUES(2,\'forbidden\')')).toThrow();
  expect(bytes.equals(original)).toBe(true);copy.close();copy.close();
  expect(new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('xiaok-sqlite-parser-')))).toEqual(before);
  expect(readFileSync(source).equals(original)).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('closes through the captured actual native method despite a replaced public close',()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-parser-close-source-'));try{
  const source=join(root,'source.sqlite'),db=new Database(source);db.exec('CREATE TABLE t(x)');db.close();const copy=openSqliteParsingCopy(readFileSync(source),false);
  let called=false;Object.defineProperty(copy.database,'close',{value(){called=true;return copy.database;}});
  copy.close();expect(called).toBe(false);expect(copy.database.open).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('retains an unknown replacement and reports cleanup failure instead of deleting it',()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-parser-replacement-source-'));let copy:ReturnType<typeof openSqliteParsingCopy>|undefined;
 try{const source=join(root,'source.sqlite'),db=new Database(source);db.exec('CREATE TABLE t(x)');db.close();copy=openSqliteParsingCopy(readFileSync(source),true);const path=copy.database.name,moved=path+'.owned-before-replacement';renameSync(path,moved);writeFileSync(path,'replacement',{flag:'wx',mode:0o600});let failure:unknown;try{copy.close();}catch(error){failure=error;}expect(isSqliteParsingCopyCleanupUnknown(failure)).toBe(true);expect(readFileSync(path,'utf8')).toBe('replacement');expect(copy.database.open).toBe(false);unlinkSync(path);renameSync(moved,path);copy.close();expect(existsSync(path)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
