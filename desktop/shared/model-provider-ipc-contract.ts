import { z } from 'zod';
import { KSWARM_AGENT_FACT_SCHEMA } from './kswarm-project-agent-ipc-contract.js';
const protocol = z.enum(['anthropic', 'openai_legacy', 'openai_responses', 'system_one']);
const effort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
type ModelLegacyFact = string | number | boolean | null | undefined | ModelLegacyFact[] | { [key: string]: ModelLegacyFact };
const fact: z.ZodType<ModelLegacyFact> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined(), z.array(fact), z.record(z.string(), fact)]));
export const MODEL_PROVIDER_ID_SCHEMA = z.string();
export const MODEL_RUNTIME_INPUT_SCHEMA = z.object({ contextLimit: z.number().finite().optional(), reasoningEffort: effort.optional() }).strict();
const runtime = MODEL_RUNTIME_INPUT_SCHEMA.catchall(fact);
const constraints = z.object({ maxContextLimit: z.number().finite().optional(), reasoningEfforts: z.array(effort).optional() }).catchall(fact);
const availableModel = z.object({ modelId: z.string(), model: z.string(), label: z.string(), capabilities: z.array(z.string()).optional(), runtimeOptions: runtime.optional(), runtimeConstraints: constraints.optional() }).strict();
const provider = z.object({ id: z.string(), label: z.string(), type: z.enum(['first_party', 'custom']), protocol, baseUrl: z.string().optional(), apiKeyConfigured: z.boolean() }).strict();
const model = z.object({ id: z.string(), provider: z.string(), model: z.string(), label: z.string(), projectAgentSelectable: z.boolean().optional(), capabilities: z.array(z.string()).optional(), runtimeOptions: runtime.optional(), runtimeConstraints: constraints.optional(), isDefault: z.boolean() }).strict();
const profile = z.object({ id: z.string(), label: z.string(), protocol, baseUrl: z.string().optional(), defaultModelId: z.string(), defaultModel: z.string(), defaultModelLabel: z.string(), capabilities: z.array(z.string()).optional(), availableModels: z.array(availableModel).optional() }).strict();
export const MODEL_CONFIG_RESULT_SCHEMA = z.object({ configuredDefaultModelId: z.string().optional(), configPath: z.string(), defaultProvider: z.string(), defaultModelId: z.string(), providers: z.array(provider), models: z.array(model), providerProfiles: z.array(profile) }).strict();
const optionalText = z.string().nullable().optional();
export const SAVE_MODEL_CONFIG_SCHEMA = z.object({ providerId: z.string(), modelId: optionalText, modelName: optionalText, label: optionalText, apiKey: optionalText, baseUrl: optionalText, protocol: protocol.nullable().optional() }).strict();
export const UPDATE_MODEL_RUNTIME_SCHEMA = z.object({ modelId: z.string(), runtimeOptions: MODEL_RUNTIME_INPUT_SCHEMA }).strict();
export const SYSTEM_ONE_PATCH_SCHEMA = z.object({ apiKey: z.string().optional(), baseUrl: z.string().optional(), model: z.string().optional() }).strict();
export const SYSTEM_ONE_RESULT_SCHEMA = z.object({ configured: z.boolean(), keySource: z.enum(['config', 'env', 'none']), keyEnvVar: z.string().nullable(), baseUrl: z.string(), model: z.string(), apiKeyMasked: z.string().nullable() }).strict();
export const MANAGED_AGENT_INPUT_SCHEMA = z.object({ id: z.string().optional(), name: z.string(), description: z.string().optional(), roles: z.array(z.string()).optional(), capabilities: z.array(z.string()).optional(), instructions: z.string().optional(), maxConcurrentTasks: z.number().finite().optional(), desktopModelId: z.string().nullable().optional() }).strict();
export const PROVIDER_CONNECTION_INPUT_SCHEMA = z.object({ providerId: z.string(), modelId: z.string().optional() }).strict();
export const MODEL_PROVIDER_INPUT_SCHEMAS = Object.freeze({
  getModelConfig: z.tuple([]), saveModelConfig: z.tuple([SAVE_MODEL_CONFIG_SCHEMA]),
  updateModelRuntimeOptions: z.tuple([UPDATE_MODEL_RUNTIME_SCHEMA]), getSystemOneConfig: z.tuple([]),
  saveSystemOneConfig: z.union([z.tuple([]), z.tuple([SYSTEM_ONE_PATCH_SCHEMA.optional()])]),
  createManagedXiaokAgent: z.tuple([MANAGED_AGENT_INPUT_SCHEMA]), testProviderConnection: z.tuple([PROVIDER_CONNECTION_INPUT_SCHEMA]),
  listAvailableModelsForProvider: z.tuple([z.string()]), deleteProvider: z.tuple([z.string()]), deleteModel: z.tuple([z.string()]),
});
export const MODEL_PROVIDER_OUTPUT_SCHEMAS = Object.freeze({
  getModelConfig: MODEL_CONFIG_RESULT_SCHEMA, saveModelConfig: MODEL_CONFIG_RESULT_SCHEMA, updateModelRuntimeOptions: MODEL_CONFIG_RESULT_SCHEMA,
  getSystemOneConfig: SYSTEM_ONE_RESULT_SCHEMA, saveSystemOneConfig: SYSTEM_ONE_RESULT_SCHEMA,
  createManagedXiaokAgent: z.object({ ok: z.literal(true), agent: KSWARM_AGENT_FACT_SCHEMA, reused: z.boolean() }).strict(),
  testProviderConnection: z.object({ success: z.boolean(), latencyMs: z.number().finite().optional(), error: z.string().optional() }).strict(),
  listAvailableModelsForProvider: z.array(availableModel), deleteProvider: z.undefined(), deleteModel: z.undefined(),
});
export type ModelProviderMethod = keyof typeof MODEL_PROVIDER_INPUT_SCHEMAS;
export type ModelConfigResult = z.infer<typeof MODEL_CONFIG_RESULT_SCHEMA>;
export type SystemOneConfigResult = z.infer<typeof SYSTEM_ONE_RESULT_SCHEMA>;
export type ManagedAgentInput = z.infer<typeof MANAGED_AGENT_INPUT_SCHEMA>;
export type ModelProviderView = z.infer<typeof provider>;
export type ModelEntryView = z.infer<typeof model>;
export type ModelProviderProfileView = z.infer<typeof profile>;
export type AvailableModelResult = z.infer<typeof availableModel>;
export type SaveModelConfigInput = z.infer<typeof SAVE_MODEL_CONFIG_SCHEMA>;
export type UpdateModelRuntimeInput = z.infer<typeof UPDATE_MODEL_RUNTIME_SCHEMA>;
export type SystemOneConfigPatch = z.infer<typeof SYSTEM_ONE_PATCH_SCHEMA>;
export type ManagedAgentResult = z.infer<typeof MODEL_PROVIDER_OUTPUT_SCHEMAS.createManagedXiaokAgent>;
export type ProviderConnectionInput = z.infer<typeof PROVIDER_CONNECTION_INPUT_SCHEMA>;
export type ProviderConnectionResult = z.infer<typeof MODEL_PROVIDER_OUTPUT_SCHEMAS.testProviderConnection>;
