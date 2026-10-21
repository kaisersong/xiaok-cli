import {vi} from 'vitest';
import type {Database} from 'better-sqlite3';
import * as rawCommands from '../../src/runtime/isolated-execution/docker-runner.js';
import type {RawReservationTransaction,createDockerRunner} from '../../src/runtime/isolated-execution/docker-runner.js';
/** Test-only fault injection into the actual compiled command. This is not an
 * issuer or a normal caller API. Normal handoff acceptance is exercised through
 * the installed execution/verification entry tests. No production overload exists. */
export function rawCommandFaultHarness(raw:ReturnType<typeof createDockerRunner>,database:Database){
 return Object.freeze({...raw,withReservationTransaction<T>(work:(transaction:RawReservationTransaction)=>T):T{
  let completed=false,result!:T;const original=rawCommands.executeRawReservationCommand;
  const fault=vi.spyOn(rawCommands,'executeRawReservationCommand').mockImplementation((command,context)=>{
   if(!rawCommands.inspectRawReservationCommand(command,raw,database))return original(command,context);
   const transaction=rawCommands.consumeExecutionCommandContext(context,raw,database,command);result=work(transaction);
   if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('verification_blob_authority_sync');}
   completed=true;return true;
  });
  try{raw.reserveExecution({ownerKey:'test-fault-only',sessionIdentity:'test',compoundOperationId:'test',validationInvocationId:'test',scopeDigest:'a'.repeat(64),command:{argv:['/bin/true'],cwdRelative:'.'},materializedInput:{} as never});throw Error('test command unexpectedly returned');}
  catch(error){if(!completed||!(error instanceof Error)||error.message!=='execution_command_result')throw error;return result;}
  finally{fault.mockRestore();}
 }});
}
