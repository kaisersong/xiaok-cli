import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createRegistrationCensusDatabase} from '../../../src/runtime/verification/registration-census-database.js';
it('never adopts a replacement native prepare installed after module bootstrap but before private open',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-prepare-capture-')),target=DatabaseSync.prototype,prior=Object.getOwnPropertyDescriptor(target,'prepare')!,original=prior.value;let calls=0,db:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{Object.defineProperty(target,'prepare',{...prior,value:function(sql:string){calls++;return Reflect.apply(original,this,[sql.includes('WITH wanted(lookup)')?sql+' WHERE 0':sql]);}});db=openPrivateVerificationDatabase(root);db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");const census=createRegistrationCensusDatabase(db)!,c=census.begin();expect(c.groups('verification_application_history',['owner']).get('owner')).toEqual([{owner_key:'owner',n:1}]);c.finish();expect(calls).toBe(0);}finally{Object.defineProperty(target,'prepare',prior);db?.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['get','all','columns','setReturnArrays','setReadBigInts'] as const)('does not adopt native Statement.%s replaced before private open',async key=>{
 const {StatementSync}=await import('node:sqlite'),root=mkdtempSync(join(tmpdir(),'native-statement-capture-')),target=StatementSync.prototype,prior=Object.getOwnPropertyDescriptor(target,key)!;let calls=0,db:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{Object.defineProperty(target,key,{...prior,value(){calls++;throw Error('replacement_statement_called');}});db=openPrivateVerificationDatabase(root);db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");const census=createRegistrationCensusDatabase(db)!,c=census.begin();expect(c.groups('verification_application_history',['owner']).get('owner')).toEqual([{owner_key:'owner',n:1}]);c.finish();expect(calls).toBe(0);}finally{Object.defineProperty(target,key,prior);db?.close();rmSync(root,{recursive:true,force:true});}
});
