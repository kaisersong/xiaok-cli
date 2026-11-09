import {z} from 'zod';
import type {IpcMainInvokeEvent} from 'electron';
import {captureIpcData} from './ipc-data-snapshot.js';
import {callTask7Producer} from './task7-typed-ipc.js';
import {registerIpcHandler} from './ipc-runtime.js';
import type {IpcHandleRegistrar,IpcHandlerListener} from './shutdown-aware-ipc-main.js';
import {USER_TASK_SUBMISSION_INPUT,USER_TASK_SUBMISSION_OUTPUT} from '../shared/user-task-submission-contract.js';
export function registerUserTaskSubmissionIpc(ipc:IpcHandleRegistrar,producer:IpcHandlerListener,authorize:(event:IpcMainInvokeEvent)=>void):void {
 registerIpcHandler({registrar:ipc,channel:'desktop:submitUserTask',payloadMode:'tuple',rolloutRound:37,
  sourceFile:'desktop/electron/user-task-submission-typed-ipc.ts',riskTags:['internal-mutation','fs-read','fs-write'],
  beforeInput:event=>{authorize(event);return undefined;},beforeOutput:event=>{authorize(event);return undefined;},
  input:z.custom<unknown[]>(()=>true).transform(raw=>{
   const data=captureIpcData(raw,'user_submission_input_invalid');const parsed=z.tuple([USER_TASK_SUBMISSION_INPUT]).safeParse(data);
   if(!parsed.success)throw Error('user_submission_input_invalid');return parsed.data;
  }),output:USER_TASK_SUBMISSION_OUTPUT,
  handler:async(args,event)=>callTask7Producer(()=>producer(event,...args) as Promise<unknown>),
  captureOutput:raw=>{const data=captureIpcData(raw,'user_submission_projection_unavailable');const parsed=USER_TASK_SUBMISSION_OUTPUT.safeParse(data);if(!parsed.success)throw Error('user_submission_projection_unavailable');return parsed.data;},
 });
}
