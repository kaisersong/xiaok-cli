import {z} from 'zod';
export const WRITER_CONTROL_METHODS=['inspect','prepare','migrate'] as const;
export type WriterControlMethod=typeof WRITER_CONTROL_METHODS[number];
export const WRITER_CONTROL_INPUT=z.tuple([]);
export const WRITER_CONTROL_OUTPUT=z.union([
 z.object({ok:z.literal(true),state:z.literal('unprepared'),reason:z.literal('none'),canPrepare:z.literal(true),canMigrate:z.literal(false)}).strict(),
 z.object({ok:z.literal(true),state:z.literal('prepared'),reason:z.literal('none'),canPrepare:z.literal(false),canMigrate:z.literal(false)}).strict(),
 z.object({ok:z.literal(false),state:z.literal('unavailable'),reason:z.enum(['not_owned','existing_data','reconciliation_required','storage_unavailable','runtime_not_ready','outcome_unknown']),canPrepare:z.literal(false),canMigrate:z.literal(false)}).strict(),
]);
export type WriterControlResult=z.infer<typeof WRITER_CONTROL_OUTPUT>;
