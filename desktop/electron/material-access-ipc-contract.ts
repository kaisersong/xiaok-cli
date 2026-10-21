// UNREVIEWED CANDIDATE: owner applies only after DESIGN approval.
import { z } from 'zod';
import { absoluteFilePath } from './file-ipc-schemas.js';
import { validateMaterialTaskId } from '../../src/runtime/task-host/material-paths.js';
export const MATERIAL_ACCESS_METHODS = ['readClipboardImage', 'selectDirectory', 'selectMaterials', 'importMaterial', 'openArtifact', 'selectHtmlEditMedia'] as const;
export type MaterialAccessMethod = typeof MATERIAL_ACCESS_METHODS[number];
export const MATERIAL_IMPORT_INPUT = z.object({
  taskId: z.string().refine(value => { try { validateMaterialTaskId(value); return true; } catch { return false; } }),
  filePath: absoluteFilePath,
  role: z.enum(['customer_material','product_material','template_material','unknown']),
}).strict();
export type MaterialAccessImportInput = z.infer<typeof MATERIAL_IMPORT_INPUT>;
export const MATERIAL_ACCESS_INPUTS = {
  readClipboardImage: z.tuple([]), selectDirectory: z.tuple([]), selectMaterials: z.tuple([]),
  importMaterial: z.tuple([MATERIAL_IMPORT_INPUT]),
  openArtifact: z.tuple([z.object({ artifactId: z.string().min(1) }).strict()]),
  // Preserve the legacy invalid_kind DTO for null/missing/unknown kind.
  selectHtmlEditMedia: z.union([z.tuple([]), z.tuple([z.object({kind:z.unknown().optional()}).strict().nullish()])]),
};
export const MATERIAL_ACCESS_OUTPUTS = {
  readClipboardImage: z.string().nullable(),
  selectDirectory: z.object({filePath:z.string()}).strict(),
  selectMaterials: z.object({filePaths:z.array(z.string())}).strict(),
  importMaterial: z.object({materialId:z.string(),originalName:z.string(),role:z.enum(['customer_material','product_material','template_material','unknown']),parseStatus:z.enum(['pending','parsed','unsupported','failed']),parseSummary:z.string().optional()}).strict(),
  // This qualifies transport only: the existing service is still a no-op.
  openArtifact: z.undefined(),
  selectHtmlEditMedia: z.object({canceled:z.boolean(),filePath:z.string(),content:z.string(),error:z.string().optional()}).strict(),
};
