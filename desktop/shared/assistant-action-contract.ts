import {z} from 'zod';
export const ASSISTANT_ACTION_PROPOSAL_SCHEMA=z.object({
 schemaVersion:z.literal(2),id:z.string().min(1).max(160),profileId:z.literal('default-personal-assistant'),
 revision:z.number().int().positive(),workItemIdentity:z.string().regex(/^[a-f0-9]{64}$/),
 originRunId:z.string().min(1),sourceVector:z.string().regex(/^[a-f0-9]{64}$/),
 actionKind:z.enum(['prepare','follow_up','review']),title:z.string().min(1).max(160),reason:z.string().min(1).max(600),
 nextStep:z.string().min(1).max(400),instruction:z.string().min(1).max(4000),
 evidenceRefs:z.array(z.object({kind:z.string().min(1).max(80),id:z.string().min(1).max(512)}).strict()).min(1).max(20),
 decision:z.enum(['open','snoozed','dismissed','expired','superseded','linked']),
 createdAt:z.number().finite(),updatedAt:z.number().finite(),validUntil:z.number().finite(),snoozeUntil:z.number().finite().nullable(),
 startAvailability:z.enum(['unavailable','available']),
}).strict();
export type AssistantActionProposalDto=z.infer<typeof ASSISTANT_ACTION_PROPOSAL_SCHEMA>;
export const ASSISTANT_ACTION_DECISION_RESULT_SCHEMA=z.discriminatedUnion('status',[
 z.object({status:z.literal('updated'),proposal:ASSISTANT_ACTION_PROPOSAL_SCHEMA}).strict(),
 z.object({status:z.literal('conflict'),proposal:ASSISTANT_ACTION_PROPOSAL_SCHEMA.nullable()}).strict(),
]);
export type AssistantActionDecisionResultDto=z.infer<typeof ASSISTANT_ACTION_DECISION_RESULT_SCHEMA>;
