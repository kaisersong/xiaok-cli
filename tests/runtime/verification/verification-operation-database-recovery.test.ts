import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {verificationRequestFixture} from '../../support/verification-request-fixture.js';
import {reopenedVerificationFixture} from '../../support/reopened-verification-fixture.js';
const signal=()=>new AbortController().signal;

it('reads the original terminal response across actual DB close/reopen with a new controller epoch',async()=>{
 const f=await verificationRequestFixture();let reopened:Awaited<ReturnType<typeof reopenedVerificationFixture>>|undefined,closed=false;try{
  const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');
  await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal());
  const history=f.operations.lookupRequest(f.query,f.peer),executions=f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all();
  await f.close(true);closed=true;reopened=await reopenedVerificationFixture(f.root,f.keys);
  expect(reopened.operations.lookupRequest(f.query,f.peer)).toEqual(history);
  expect(await reopened.operations.recoverRequest({...f.query,requestSource:'scheduler'},f.peer,signal())).toEqual(history);
  expect(reopened.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all()).toEqual(executions);
  expect(reopened.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).not.toBe('valid');
  expect(()=>reopened!.operations.stageVerifiedPayload(f.owner)).toThrow();
 }finally{if(reopened)await reopened.close();else if(!closed)await f.close();}
});

it('finishes the original physically cancelled request after actual DB close/reopen without a producer capability',async()=>{
 const f=await verificationRequestFixture();let reopened:Awaited<ReturnType<typeof reopenedVerificationFixture>>|undefined,closed=false;try{
  const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');
  f.database.exec("CREATE TRIGGER interrupted_cancel BEFORE UPDATE ON verification_operations WHEN NEW.state='cancelled' BEGIN SELECT RAISE(IGNORE); END");
  await expect(f.operations.recoverRequest({...f.query,requestSource:'user'},f.peer,signal())).rejects.toThrow();
  f.database.exec('DROP TRIGGER interrupted_cancel');
  const executions=f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all();
  await f.close(true);closed=true;reopened=await reopenedVerificationFixture(f.root,f.keys);
  expect(await reopened.operations.recoverRequest({...f.query,requestSource:'scheduler'},f.peer,signal())).toMatchObject({state:'operation',operation:{id:p.operationHandle.id,state:'cancelled'}});
  expect(reopened.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all()).toEqual(executions);
  await expect(reopened.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal())).rejects.toThrow();
 }finally{if(reopened)await reopened.close();else if(!closed)await f.close();}
});
