// Original semantic transport/public data contract; business and native authority unchanged.
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
type DesktopServices = ReturnType<typeof createDesktopServices>;
import type { DesktopGoalMutationResult } from './preload-api.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { GOAL_TASK_MUTATION_OUTPUT } from '../shared/goal-task-mutation-ipc-contract.js';
export const GOAL_TASK_MUTATION_METHODS = ['create', 'resume', 'replace'] as const;
export type GoalTaskMutationMethod = typeof GOAL_TASK_MUTATION_METHODS[number];
type Services = Pick<DesktopServices, 'createGoal' | 'resumeGoal' | 'replaceGoal'>;
type CreateInput = Parameters<Services['createGoal']>[0];
type ResumeInput = Parameters<Services['resumeGoal']>[0];
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());
const projectionError = 'goal_task_mutation_projection_unavailable';

/** Original inline resume parser closed over the ORIGINAL two scalar parser references.
 * Validation/order/errors retained. Numeric casts narrow the already validated public field,
 * never private SDK/owner brands. No parser call authorizes execution. */
function parseResumeOriginal(raw: unknown, parseGoalThreadId: (v: unknown) => string,
  parseGoalRequestId: (v: unknown) => string | undefined): ResumeInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_goal_resume_input');
  const input = raw as Record<string, unknown>;
  const fields = Object.keys(input).filter(key => !['threadId', 'turnLimit', 'requestId'].includes(key));
  if (fields.length > 0) throw new Error(`invalid_goal_field:${fields[0]}`);
  const requestId = parseGoalRequestId(input.requestId);
  const turnLimit = input.turnLimit;
  if (turnLimit !== undefined && (!Number.isSafeInteger(turnLimit) || (turnLimit as number) < 1 || (turnLimit as number) > 50)) {
    throw new Error('invalid_goal_turn_limit');
  }
  return {
    threadId: parseGoalThreadId(input.threadId),
    ...(requestId === undefined ? {} : { requestId }),
    ...(turnLimit === undefined ? {} : { turnLimit: turnLimit as number }),
  };
}
export function registerGoalTaskMutationsIpc(
  ipc: IpcHandleRegistrar, services: Services,
  parseGoalInput: (raw: unknown, operation: 'create' | 'replace') => CreateInput,
  parseGoalThreadId: (v: unknown) => string,
  parseGoalRequestId: (v: unknown) => string | undefined,
  authorize: (event: IpcMainInvokeEvent) => void,
): void {
  const captureReply = (raw: DesktopGoalMutationResult): DesktopGoalMutationResult => {
    const data = captureIpcData(raw, projectionError);
    if (!GOAL_TASK_MUTATION_OUTPUT.safeParse(data).success) throw Error(projectionError);
    return data;
  };
  function registerOne<Input extends object>(method: GoalTaskMutationMethod,
    parseOriginal: (raw: unknown) => Input, producer: (input: Input) => Promise<DesktopGoalMutationResult>) {
    registerIpcHandler<[Input], DesktopGoalMutationResult>({
      registrar: ipc, channel: 'desktop:goal:' + method, payloadMode: 'tuple', rolloutRound: 37,
      sourceFile: 'desktop/electron/goal-task-mutation-typed-ipc.ts',
      riskTags: ['internal-mutation', 'fs-read', 'fs-write', 'exec'],
      beforeInput: event => { authorize(event); return undefined; },
      beforeOutput: event => { authorize(event); return undefined; },
      input: z.custom<[Input]>(() => true).transform((raw): [Input] => {
        const snapshot = captureIpcData(raw, 'goal_task_mutation_input_invalid');
        if (!Array.isArray(snapshot) || snapshot.length !== 1 || !Object.hasOwn(snapshot, '0')) throw Error('goal_task_mutation_input_invalid');
        // Includes verificationDefinition for create/replace: original closed parser exactly once.
        return [parseOriginal(snapshot[0])];
      }),
      handler: args => {
        assertStandardIpcPromise(witness, projectionError);
        const raw = producer(args[0]);
        assertStandardIpcPromise(raw, projectionError);
        return new NativePromise<DesktopGoalMutationResult>((resolve, reject) => apply(nativeThen, raw, [
          (value: DesktopGoalMutationResult) => { try { resolve(captureReply(value)); } catch (error) { reject(error); } }, reject,
        ]));
      }, captureOutput: captureReply, output: GOAL_TASK_MUTATION_OUTPUT,
    });
  }
  registerOne('create', raw => parseGoalInput(raw, 'create'), input => services.createGoal(input));
  registerOne('resume', raw => parseResumeOriginal(raw, parseGoalThreadId, parseGoalRequestId), input => services.resumeGoal(input));
  registerOne('replace', raw => parseGoalInput(raw, 'replace'), input => services.replaceGoal(input));
}
