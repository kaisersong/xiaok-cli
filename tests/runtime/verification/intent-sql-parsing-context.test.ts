import {describe,it,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import * as decoder from '../../../src/runtime/verification/intent-contract-enrollment.js';
import {readIntentSqlContract,withIntentSqlParsingContext} from '../../../src/runtime/verification/intent-sql-parsing-context.js';

function fixture(){
 const db=new Database(':memory:');db.exec('CREATE TABLE receipts(id INTEGER PRIMARY KEY,contract_json TEXT NOT NULL)');
 const candidate=intentApplicationCandidate(),contract=candidate.contract,subjects=[...contract.stages.map(stage=>({...candidate.subject,stageId:stage.stageId})),{...candidate.subject,stageId:null}];
 subjects.forEach((subject,i)=>db.prepare('INSERT INTO receipts VALUES(?,?)').run(i,json({contract,subject})));
 const read=(id:number)=>readIntentSqlContract(db,(db.prepare('SELECT contract_json FROM receipts WHERE id=?').get(id) as {contract_json:string}).contract_json);
 return {db,candidate,contract,subjects,read};
}
describe('private synchronous pure SQL parsing context',()=>{
 it('reads each actual SQL subject, shares only deeply immutable pure contract, and clears on exit',()=>{
  const f=fixture(),spy=vi.spyOn(decoder,'parseIntentContractEnrollment');try{
   withIntentSqlParsingContext(f.db,()=>{const first=f.read(0);for(let i=1;i<f.subjects.length;i++){const next=f.read(i);expect(next.subject).toEqual(f.subjects[i]);expect(next.contract).toBe(first.contract);}expect(Object.isFrozen(first.contract.stages[0].steps[0])).toBe(true);expect(Reflect.set(first.contract.stages[0],'label','malicious')).toBe(false);expect(first.contract.stages[0].label).toBe(f.contract.stages[0].label);});expect(spy).toHaveBeenCalledTimes(1);f.read(0);expect(spy).toHaveBeenCalledTimes(2);
  }finally{spy.mockRestore();f.db.close();}
 });
 it('restores independent outer frame on nested success and throw; another database falls back',()=>{
  const f=fixture(),other=fixture(),spy=vi.spyOn(decoder,'parseIntentContractEnrollment');try{
   withIntentSqlParsingContext(f.db,()=>{f.read(0);other.read(0);withIntentSqlParsingContext(f.db,()=>{f.read(1);f.read(0);});f.read(1);expect(()=>withIntentSqlParsingContext(f.db,()=>{f.read(0);throw Error('actual_nested_failure');})).toThrow('actual_nested_failure');f.read(1);withIntentSqlParsingContext(other.db,()=>{other.read(0);other.read(1);});f.read(0);});expect(spy).toHaveBeenCalledTimes(5);f.read(0);expect(spy).toHaveBeenCalledTimes(6);
  }finally{spy.mockRestore();f.db.close();other.db.close();}
 });
 it('re-reads actual replaced SQL body, evicts one body, and cannot reuse a wrong subject',()=>{
  const f=fixture(),spy=vi.spyOn(decoder,'parseIntentContractEnrollment');try{withIntentSqlParsingContext(f.db,()=>{
   const original=f.read(0),changed={...f.contract,normalizedIntent:'changed actual SQL'};f.db.prepare('UPDATE receipts SET contract_json=? WHERE id=0').run(json({contract:changed,subject:f.subjects[0]}));expect(f.read(0).contract.normalizedIntent).toBe('changed actual SQL');f.db.prepare('UPDATE receipts SET contract_json=? WHERE id=0').run(json({contract:f.contract,subject:f.subjects[0]}));expect(f.read(0)).toEqual(original);expect(spy).toHaveBeenCalledTimes(3);
   f.db.prepare('UPDATE receipts SET contract_json=? WHERE id=0').run(json({contract:f.contract,subject:{...f.subjects[0],stageId:'outside'}}));expect(()=>f.read(0)).toThrow('intent_enrollment_subject');
  });}finally{spy.mockRestore();f.db.close();}
 });
 it('keeps original strict decoding and canonical rejection for adversarial actual text',()=>{
  const f=fixture();try{const canonical=json({contract:f.contract,subject:f.subjects[0]}),adversarial=[canonical+'x',canonical.slice(0,-1)+',"extra":0}',canonical.replace('"version":1','"version":1,"version":1'),canonical.replace('"order":0','"order":-0'),JSON.stringify({subject:f.subjects[0],contract:f.contract}),canonical.replace('"subject":','"subject" :'),canonical.replace('"stageId":', '"stageId" :')];withIntentSqlParsingContext(f.db,()=>{f.read(0);for(const text of adversarial){let expected:any,error:unknown;try{expected=decoder.parseIntentContractEnrollment(JSON.parse(text));}catch(e){error=e;}if(error)expect(()=>readIntentSqlContract(f.db,text)).toThrow((error as Error).message);else{const actual=readIntentSqlContract(f.db,text);expect(actual).toEqual(expected);expect(json(actual)).not.toBe(text);}}});}finally{f.db.close();}
 });
 it('does not locate a root delimiter inside quoted contract or subject content',()=>{
  const f=fixture();try{const contract={...f.contract,rawIntent:'literal ,"subject": and } inside text'},text=json({contract,subject:f.subjects[0]});withIntentSqlParsingContext(f.db,()=>{expect(readIntentSqlContract(f.db,text)).toEqual(decoder.parseIntentContractEnrollment(JSON.parse(text)));expect(readIntentSqlContract(f.db,json({contract,subject:f.subjects[1]})).subject).toEqual(f.subjects[1]);});}finally{f.db.close();}
 });
});
