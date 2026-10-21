import {inspectRawReservationCommand,executeRawReservationCommand} from '../isolated-execution/docker-runner.js';
import {inspectMountedProbeCommand,executeMountedProbeCommand} from '../isolated-execution/mounted-engine-probe.js';
import {inspectBlackboxPreparationCommand,executeBlackboxPreparationCommand} from './approved-blackbox-executor.js';
import {inspectVerificationPreparationCommand,executeVerificationPreparationCommand} from './approved-verification-operation.js';
import type {Database} from 'better-sqlite3';
import {inspectMaterialExecutionCommand,executeMaterialExecutionCommand} from './installed-execution-controller.js';
export interface ExecutionWriteContext {readonly __executionWriteContext?:never}
export function inspectExecutionPreparationCommand(command:object,raw:object,database:Database):void{
 if(inspectRawReservationCommand(command,raw,database))return;
 if(inspectMountedProbeCommand(command,raw,database))return;
 if(inspectMaterialExecutionCommand(command,raw,database))return;
 if(inspectVerificationPreparationCommand(command,raw,database))return;
 if(inspectBlackboxPreparationCommand(command,raw,database))return;
 throw Error('execution_command_brand');
}
export function executeExecutionPreparationCommand(command:object,context:ExecutionWriteContext):void{
 if(executeRawReservationCommand(command,context))return;
 if(executeMountedProbeCommand(command,context))return;
 if(executeMaterialExecutionCommand(command,context))return;
 if(executeVerificationPreparationCommand(command,context))return;
 if(executeBlackboxPreparationCommand(command,context))return;
 throw Error('execution_command_brand');
}
