import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as runners from '../../../src/runtime/isolated-execution/docker-runner.js';
import {ExecutionJournal} from '../../../src/runtime/isolated-execution/execution-journal.js';
import {MaintenanceExecutionConstruction,hasUnresolvedMaintenanceExecutionConstruction} from '../../../src/runtime/verification/maintenance-execution-construction.js';

// Actual raw/journal and real installed DB/budget, no replacement authority or
// attachment. The extra raw owns no allocation and performs no engine operation.
async function resources(){
 const observed=vi.spyOn(runners,'createDockerRunner');
 try{
  const f=await installedControllerFixture();
  try{const input=observed.mock.calls.find(([options])=>options.database===f.database);
   if(!input)throw Error('actual installed raw construction missing');
   return {f,raw:runners.createDockerRunner(input[0])};
  }catch(error){try{await f.close();}catch(cleanup){throw new AggregateError([error,cleanup],'control_resource_setup_unknown',{cause:error});}throw error;}
 }finally{observed.mockRestore();}
}
function contains(error:unknown,wanted:unknown):boolean{return error===wanted||error instanceof AggregateError&&error.errors.some(item=>contains(item,wanted));}

it('closes the actual raw when the later extra journal construction fails',async()=>{
 const {f,raw}=await resources(),capsule=new MaintenanceExecutionConstruction(f.lifetime,{}),primary=Error('extra journal constructor fault');
 const actualExec=f.database.exec.bind(f.database),close=vi.spyOn(ExecutionJournal.prototype,'close');
 const fault=vi.spyOn(f.database,'exec').mockImplementation(sql=>{if(sql.includes('CREATE TABLE IF NOT EXISTS execution_attempts'))throw primary;return actualExec(sql);});
 try{
  capsule.holdRaw(raw);
  let caught:unknown;try{capsule.openJournal();}catch(error){caught=error;}
  expect(caught).toBe(primary);expect(capsule.fail(caught)).toBe(primary);expect(close).toHaveBeenCalledTimes(1);
  expect(()=>capsule.openJournal()).toThrow('maintenance_execution_construction');
 }finally{fault.mockRestore();close.mockRestore();raw.close();await f.close();}
});

it('attempts both real disposals, retains every error and never upgrades an unknown drain',async()=>{
 const {f,raw}=await resources(),ticket={},capsule=new MaintenanceExecutionConstruction(f.lifetime,ticket),primary=Error('binding fault'),extraFailure=Error('extra journal close fault'),rawFailure=Error('raw journal close fault');
 capsule.holdRaw(raw);const extra=capsule.openJournal(),actualClose=ExecutionJournal.prototype.close,attempts:ExecutionJournal[]=[];
 const close=vi.spyOn(ExecutionJournal.prototype,'close').mockImplementation(function(this:ExecutionJournal){attempts.push(this);throw this===extra?extraFailure:rawFailure;});
 try{
  const failure=capsule.fail(primary);expect(failure).toBeInstanceOf(AggregateError);
  for(const error of [primary,extraFailure,rawFailure])expect(contains(failure,error)).toBe(true);
  expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(extra);expect(attempts[1]).not.toBe(extra);
  expect(hasUnresolvedMaintenanceExecutionConstruction(failure,ticket)).toBe(true);
  expect(hasUnresolvedMaintenanceExecutionConstruction(failure,{...ticket})).toBe(false);
  expect(hasUnresolvedMaintenanceExecutionConstruction(new AggregateError([failure],'maintenance_execution_partial_construction_unknown'),ticket)).toBe(false);
  expect(()=>capsule.dispose()).toThrow('maintenance_execution_disposal_unknown');expect(attempts).toHaveLength(2);
 }finally{
  close.mockRestore();for(const journal of attempts)actualClose.call(journal);raw.close();await f.close();
 }
});
