import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {assertVerificationDatabaseBudget} from '../../../src/runtime/verification/storage-budget.js';
it('counts the durable qualification intent and preserves terminal headroom in the same actual DB',()=>{
 const Native=createRequire(import.meta.url)('better-sqlite3'),db=new Native(':memory:');
 try{db.exec('CREATE TABLE verification_engine_qualification(id INTEGER PRIMARY KEY,record_json TEXT NOT NULL)');db.prepare('INSERT INTO verification_engine_qualification VALUES(1,?)').run('{}');const pages=db.pragma('page_count',{simple:true})*db.pragma('page_size',{simple:true});expect(()=>assertVerificationDatabaseBudget(db,{additionalBytes:0,limitBytes:pages+4096})).toThrow('verification_control_budget');}finally{db.close();}
});
