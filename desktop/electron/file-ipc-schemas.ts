import { isAbsolute } from 'node:path';
import { z } from 'zod';
// Native absolute paths, including drive roots and UNC. Preserve filename whitespace.
export const absoluteFilePath = z.string().min(1).max(32767).refine(value => !value.includes('\0') && isAbsolute(value), 'absolute file path required');
export const filePathInput = z.object({ filePath: absoluteFilePath }).strict();
export const saveFileInput = z.object({ filePath: absoluteFilePath, content: z.string(), purpose: z.enum(['html-edit', 'text-edit']).optional() }).strict();
export const openFileResult = z.union([z.object({ ok: z.literal(true) }).strict(), z.object({ ok: z.literal(false), error: z.string() }).strict()]);
export const readFileResult = z.object({ content: z.string(), error: z.string().optional() }).strict();
export const saveFileResult = z.object({ success: z.boolean(), error: z.string().optional() }).strict();
