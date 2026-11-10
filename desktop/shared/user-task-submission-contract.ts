import {z} from 'zod';
import {TASK7_UNDERSTANDING} from './task7-ipc-contract.js';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
export const USER_SUBMISSION_ID=z.string().regex(/^main-submission:[a-f0-9-]{36}:[a-f0-9-]{36}$/);
const context=z.object({threadId:z.string().trim().min(1).max(200).optional(),taskIds:z.array(z.string().trim().min(1).max(200)).optional()}).strict();
const common={prompt:z.string(),context:context.optional(),permissionMode:z.enum(['auto','default','plan']).optional()};
export const USER_SUBMISSION_TASK_INPUT=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('materials'),...common,materials:z.array(z.object({materialId:z.string().trim().min(1),role:z.enum(['customer_material','product_material','template_material','unknown']).optional()}).strict())}).strict(),
 z.object({kind:z.literal('files'),...common,filePaths:z.array(z.string())}).strict(),
]);
export const USER_TASK_SUBMISSION_INPUT=z.discriminatedUnion('action',[
 z.object({action:z.literal('submit_new'),gestureId:uuid,input:USER_SUBMISSION_TASK_INPUT}).strict(),
 z.object({action:z.literal('retry_existing'),submissionId:USER_SUBMISSION_ID}).strict(),
]);
export const USER_TASK_SUBMISSION_OUTPUT=z.object({submissionId:USER_SUBMISSION_ID,taskId:z.string().min(1),understanding:TASK7_UNDERSTANDING.optional()}).strict();
export type UserTaskSubmissionInput=z.infer<typeof USER_TASK_SUBMISSION_INPUT>;
export type UserSubmissionTaskInput=z.infer<typeof USER_SUBMISSION_TASK_INPUT>;
export type UserTaskSubmissionOutput=z.infer<typeof USER_TASK_SUBMISSION_OUTPUT>;
