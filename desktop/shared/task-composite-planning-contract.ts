import {z} from 'zod';
const id=z.string().min(1).max(512);
const taskFields=['brief','description','requirements','acceptanceCriteria','assignedAgent','assignee','dependencies','dependencyPolicy','phaseId','type','maxAttempts','maxQualityReworks','requiredOutputs','requiredCapabilities','executionGateSchemaVersion','executionContract','evidenceContract','composite','requiresIndependentReview','reviewAgent','reviewBrief','finalBrief'] as const;
const task=z.object({title:z.string().trim().min(1),...Object.fromEntries(taskFields.map(key=>[key,z.unknown().optional()]))}).strict();
/** Proposal data only. Main supplies retained text and the original owner grant. */
export const TASK_COMPOSITE_PROPOSAL=z.union([
 z.object({title:z.string().trim().min(1),brief:z.string().optional()}).strict(),
 z.object({tasks:z.array(task).min(1).max(200)}).strict(),
]);
export const TASK_METADATA_PLANNING_INPUT=z.object({action:z.literal('add_task_and_plan'),projectId:id,sourceTaskId:id,proposal:TASK_COMPOSITE_PROPOSAL}).strict();
export const TASK_METADATA_PLANNING_OUTPUT=z.object({ok:z.literal(true),status:z.literal('metadata_applied'),projectId:id,operationId:z.string().regex(/^ordinary-input:[a-f0-9]{64}$/),planRunId:z.string().uuid(),ownerRevision:z.number().int().positive().safe(),execution:z.object({state:z.literal('blocked'),reasonCode:z.literal('CANDIDATE_WORKSPACE_UNAVAILABLE')}).strict()}).strict();
export type TaskMetadataPlanningInput=z.infer<typeof TASK_METADATA_PLANNING_INPUT>;
