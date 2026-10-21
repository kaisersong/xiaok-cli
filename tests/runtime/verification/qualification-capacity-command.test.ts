import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import * as transactions from '../../../src/runtime/verification/blob-transaction-command-dispatch.js';
import * as commands from '../../../src/runtime/verification/capacity-command-dispatch.js';
import {createPrimitiveBlobAuthority} from '../../support/primitive-blob-authority.js';
import {createInstalledEngineQualification} from '../../../src/runtime/verification/installed-engine-qualification.js';
vi.mock('../../../src/runtime/verification/installed-engine.js',()=>({assertInstalledMacEngineHandle(){},assertInstalledEngineDatabase(){},inspectInstalledMacEngineHandle:async()=>{}}));
vi.mock('../../../src/runtime/verification/root-broker-client.js',()=>({createInstalledRootBrokerClient:()=>({dispose(){}})}));
vi.mock('../../../src/runtime/isolated-execution/docker-engine-transport.js',()=>({DockerEngineTransport:class{async create(){throw Error('fixture engine dispatch stopped');}async recoverAttempt(){throw Error('fixture no engine');}}}));
// Assembly fixture exercises real SQLite/journal/budget; the mocked installed
// identity and engine boundary are not an OS qualification or actual dispatch.
it('uses an actual private command for the qualification allocation and original durable intent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qualification-command-')),db=openPrivateVerificationDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'qualification-command',assertCurrent(){},deletion:{assertDeleted(){throw Error('no physical deletion');}}}).budget;
 const engine={hostSocket:'/unused-fixture.sock',imageDigest:'sha256:'+'a'.repeat(64),observation:{engineId:'fixture-engine'}};const qualification=createInstalledEngineQualification({engine:engine as never,database:db,budget}),dispatch=vi.spyOn(commands,'executePreparedCapacityCommand'),whole=vi.spyOn(transactions,'executeBlobTransactionCommand');
 try{await expect(qualification.qualify()).rejects.toThrow('fixture engine dispatch stopped');expect(dispatch).toHaveBeenCalledTimes(1);expect(whole).toHaveBeenCalledTimes(1);const row=db.prepare('SELECT record_json FROM verification_engine_qualification WHERE id=1').get() as {record_json:string};const record=JSON.parse(row.record_json);expect(record.deleted).toBe(false);expect(budget.getState(record.allocation)).toBe('reserved');expect(db.inTransaction).toBe(false);}
 finally{whole.mockRestore();dispatch.mockRestore();qualification.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('rolls back the actual journal and allocation when the fixed qualification intent write fails',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qualification-command-rollback-')),db=openPrivateVerificationDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'qualification-command',assertCurrent(){},deletion:{assertDeleted(){throw Error('no physical deletion');}}}).budget;const engine={hostSocket:'/unused-fixture.sock',imageDigest:'sha256:'+'a'.repeat(64),observation:{engineId:'fixture-engine'}},qualification=createInstalledEngineQualification({engine:engine as never,database:db,budget});
 try{db.exec("CREATE TRIGGER reject_qualification BEFORE INSERT ON verification_engine_qualification BEGIN SELECT RAISE(ABORT,'qualification intent failure'); END");await expect(qualification.qualify()).rejects.toThrow('qualification intent failure');for(const table of ['verification_blob_reservations','execution_attempts','verification_engine_qualification'])expect(db.prepare('SELECT COUNT(*) n FROM '+table).get()).toEqual({n:0});expect(db.inTransaction).toBe(false);}
 finally{qualification.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
