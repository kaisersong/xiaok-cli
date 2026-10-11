import { z, type ZodSchema } from 'zod';
import type { RiskTag } from './ipc-runtime.js';
import type { MemoryIpcEntry, MemoryImportIpcResult, MemoryStatsIpcSnapshot, MemoryPersonaIpcTrait, MemoryLayerIpcEntry, EmbeddingModelIpcEntry } from '../shared/memory-ipc-types.js';
const memoryEntry: ZodSchema<MemoryIpcEntry> = z.object({ id: z.string(), content: z.string(), tags: z.array(z.string()), createdAt: z.number() }).strict();
const importResult: ZodSchema<MemoryImportIpcResult> = z.object({ imported: z.number(), deduped: z.number(), parseErrors: z.array(z.string()) }).strict();
const stats: ZodSchema<MemoryStatsIpcSnapshot> = z.object({ l0: z.number(), l1: z.number(), l2: z.number(), l3: z.number(), dbSizeBytes: z.number() }).strict();
const persona: ZodSchema<MemoryPersonaIpcTrait> = z.object({ trait: z.string(), confidence: z.number() }).strict();
const layerEntry: ZodSchema<MemoryLayerIpcEntry> = z.object({
  id: z.string(), content: z.string(), tags: z.array(z.string()).optional(), createdAt: z.string().optional(),
  meta: z.object({ role: z.string().optional(), sessionId: z.string().optional(), scope: z.string().optional(), type: z.string().nullable().optional(), keyFacts: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(), confidence: z.number().optional() }).strict().optional(),
}).strict();
const modelEntry: ZodSchema<EmbeddingModelIpcEntry> = z.object({ id: z.string(), name: z.string(), dims: z.number(), size: z.string(), languages: z.string(), downloaded: z.boolean(), active: z.boolean(), manualHint: z.object({ urls: z.array(z.object({ file: z.string(), url: z.string() }).strict()), targetDir: z.string() }).strict() }).strict();
const ignoredInput = z.preprocess(() => undefined, z.void());
const contractViolation = (): never => { throw new Error('ipc_contract_violation'); };
const importFailure = (error: unknown): MemoryImportIpcResult => ({ imported: 0, deduped: 0, parseErrors: [`导入失败: ${error}`] });
// The transport supplies an argument array. Only these positions were consumed
// by the original handlers; pad omitted positions without changing their defaults.
const positions = (size: number) => (args: unknown): unknown => Array.isArray(args)
  ? Array.from({ length: size }, (_, index) => args[index])
  : args;
interface MemoryContract {
  input: ZodSchema; output: ZodSchema; riskTags: RiskTag[]; payloadMode: 'single' | 'tuple';
  inputError?: (error: unknown) => unknown; outputError: (error: unknown) => unknown;
}
const single = (input: ZodSchema, output: ZodSchema, riskTags: RiskTag[], fallback?: (error: unknown) => unknown): MemoryContract => ({
  input, output, riskTags, payloadMode: 'single', ...(fallback ? { inputError: fallback } : {}), outputError: fallback ?? contractViolation,
});
export const MEMORY_IPC_CONTRACTS = {
  listMemories: single(ignoredInput, z.array(memoryEntry), ['fs-read'], () => []),
  createMemory: single(z.object({ content: z.string(), tags: z.array(z.string()), source: z.string().optional() }), memoryEntry, ['fs-read', 'fs-write-userData']),
  updateMemory: single(z.object({ id: z.string(), content: z.string().optional(), tags: z.array(z.string()).optional() }), memoryEntry, ['fs-read', 'fs-delete', 'fs-write-userData']),
  deleteMemory: single(z.string(), z.boolean(), ['fs-delete', 'fs-write-userData']),
  importMemories: single(z.string(), importResult, ['fs-read', 'fs-write-userData'], importFailure),
  memoryStats: single(ignoredInput, stats.nullable(), ['fs-read'], () => null),
  memoryCompact: single(ignoredInput, z.boolean(), ['fs-read', 'fs-write-userData', 'network'], () => false),
  memoryPersonaTraits: single(ignoredInput, z.array(persona), ['fs-read'], () => []),
  memoryListLayer: { ...single(z.preprocess(positions(3), z.tuple([z.number(), z.number().nullish(), z.number().nullish()])), z.array(layerEntry), ['fs-read'], () => []), payloadMode: 'tuple' },
  memoryDeleteEntry: { ...single(z.preprocess(positions(2), z.tuple([z.string(), z.number().optional()])), z.boolean(), ['fs-delete', 'fs-write-userData'], () => false), payloadMode: 'tuple' },
  memoryClearAll: single(ignoredInput, z.boolean(), ['fs-delete', 'fs-write-userData'], () => false),
  memoryGetModelId: single(ignoredInput, z.string().nullable(), ['fs-read'], () => null),
  memorySetModelId: single(z.string().nullish(), z.boolean(), ['fs-read', 'fs-write-userData'], () => false),
  getEmbeddingModels: single(ignoredInput, z.array(modelEntry), ['fs-read'], () => []),
  downloadEmbeddingModel: single(z.string(), z.void(), ['fs-read', 'fs-delete', 'network', 'fs-write-userData']),
  setEmbeddingModel: single(z.string(), z.void(), ['fs-read', 'fs-delete', 'fs-write-userData']),
} satisfies Record<string, MemoryContract>;
export type MemoryIpcOperation = keyof typeof MEMORY_IPC_CONTRACTS;
