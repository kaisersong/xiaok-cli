import { z } from 'zod';

const labels = ['inbox', 'todo', 'waiting', 'someday', 'archived'] as const;
export const THREAD_META_MIGRATION_INPUT_SCHEMA = z.object({
  gtdEnabled: z.boolean().optional(), inbox: z.array(z.string()).optional(),
  todo: z.array(z.string()).optional(), waiting: z.array(z.string()).optional(),
  someday: z.array(z.string()).optional(), archived: z.array(z.string()).optional(),
  pinned: z.array(z.string()).optional(),
}).strict();
export const THREAD_META_SNAPSHOT_SCHEMA = THREAD_META_MIGRATION_INPUT_SCHEMA.required();
export const THREAD_META_WRITE_RESULT_SCHEMA = z.object({ ok: z.boolean(), degraded: z.boolean().optional() }).strict();
export const THREAD_META_MIGRATION_RESULT_SCHEMA = z.union([
  z.object({ ok: z.literal(true), migrated: z.literal(true) }).strict(),
  z.object({ ok: z.literal(true), migrated: z.literal(false), reason: z.literal('already_done') }).strict(),
  z.object({ ok: z.literal(false), degraded: z.literal(true), migrated: z.literal(false), reason: z.literal('degraded') }).strict(),
  z.object({ ok: z.literal(false), migrated: z.literal(false), reason: z.string() }).strict(),
]);
export const THREAD_META_INPUT_SCHEMAS = Object.freeze({
  getThreadLabels: z.tuple([]),
  setThreadLabel: z.tuple([z.string(), z.enum([...labels, 'pinned'])]),
  unsetThreadLabel: z.tuple([z.string(), z.enum([...labels, 'pinned'])]),
  moveThreadLabel: z.tuple([z.string(), z.enum(labels), z.enum(labels)]),
  getAppFlag: z.tuple([z.string()]), setAppFlag: z.tuple([z.string(), z.string()]),
  migrateLegacyThreadMeta: z.tuple([THREAD_META_MIGRATION_INPUT_SCHEMA]),
});
export const THREAD_META_OUTPUT_SCHEMAS = Object.freeze({
  getThreadLabels: THREAD_META_SNAPSHOT_SCHEMA,
  setThreadLabel: THREAD_META_WRITE_RESULT_SCHEMA, unsetThreadLabel: THREAD_META_WRITE_RESULT_SCHEMA,
  moveThreadLabel: THREAD_META_WRITE_RESULT_SCHEMA, getAppFlag: z.string().nullable(),
  setAppFlag: THREAD_META_WRITE_RESULT_SCHEMA, migrateLegacyThreadMeta: THREAD_META_MIGRATION_RESULT_SCHEMA,
});
export type ThreadMetadataMethod = keyof typeof THREAD_META_OUTPUT_SCHEMAS;
export type ThreadMetadataSnapshotDto = z.infer<typeof THREAD_META_SNAPSHOT_SCHEMA>;
export type ThreadMetadataMigrationInputDto = z.infer<typeof THREAD_META_MIGRATION_INPUT_SCHEMA>;
export type ThreadMetadataWriteResultDto = z.infer<typeof THREAD_META_WRITE_RESULT_SCHEMA>;
export type ThreadMetadataMigrationResultDto = z.infer<typeof THREAD_META_MIGRATION_RESULT_SCHEMA>;
