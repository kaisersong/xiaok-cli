import { isAbsolute } from 'node:path';
import { z } from 'zod';
// Native absolute paths, including drive roots and UNC. Preserve filename whitespace.
export const absoluteFilePath = z.string().min(1).max(32767).refine(value => !value.includes('\0') && isAbsolute(value), 'absolute file path required');
export const filePathInput = z.object({ filePath: absoluteFilePath }).strict();
export const saveFileInput = z.object({ filePath: absoluteFilePath, content: z.string(), purpose: z.enum(['html-edit', 'text-edit']).optional() }).strict();
export const openFileResult = z.union([z.object({ ok: z.literal(true) }).strict(), z.object({ ok: z.literal(false), error: z.string() }).strict()]);
export const readFileResult = z.object({ content: z.string(), error: z.string().optional() }).strict();
export const saveFileResult = z.object({ success: z.boolean(), error: z.string().optional() }).strict();
// Legacy clipboard handlers do not consume any invoke payload.
export const ignoredClipboardInput = z.unknown().transform(() => undefined);
export const clipboardFilePathsResult = z.array(z.string());
// Save-dialog defaults accept missing input and null filters; relative filenames
// and native Windows path syntax are passed to the dialog without normalization.
export const showSaveDialogInput = z.object({
    defaultPath: z.string().optional(),
    filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).nullish(),
}).nullish();
export const showSaveDialogResult = z.object({ canceled: z.boolean(), filePath: z.string() }).strict();
