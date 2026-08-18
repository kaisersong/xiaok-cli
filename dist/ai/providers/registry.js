function createKimiK3Variant(modelId, model = 'k3', label = 'Kimi K3') {
    return {
        modelId,
        model,
        label,
        capabilities: ['tools', 'thinking'],
        runtimeOptions: {
            contextLimit: 262_144,
            reasoningEffort: 'high',
        },
        runtimeConstraints: {
            maxContextLimit: 1_048_576,
            reasoningEfforts: ['low', 'high', 'max'],
        },
    };
}
const PROVIDER_REGISTRY = {
    openai: {
        id: 'openai',
        label: 'OpenAI',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.openai.com/v1',
        envPrefixes: ['OPENAI'],
        // contextLimit 逐个查证于 https://developers.openai.com/api/docs/models/<model>
        // 官方语义是「总窗口，含输入 + 输出 + reasoning tokens」。
        defaultModel: {
            modelId: 'openai-default',
            model: 'gpt-4o',
            label: 'GPT-4o',
            capabilities: ['tools'],
            runtimeOptions: { contextLimit: 128_000 },
        },
        availableModels: [
            { modelId: 'openai-gpt-5.5', model: 'gpt-5.5', label: 'GPT-5.5', capabilities: ['tools'], runtimeOptions: { contextLimit: 1_050_000 } },
            { modelId: 'openai-gpt-5', model: 'gpt-5', label: 'GPT-5', capabilities: ['tools'], runtimeOptions: { contextLimit: 400_000 } },
            // 与 defaultModel 共享 wireModel，元数据必须逐字一致
            { modelId: 'openai-gpt-4o', model: 'gpt-4o', label: 'GPT-4o', capabilities: ['tools'], runtimeOptions: { contextLimit: 128_000 } },
            { modelId: 'openai-gpt-4.1', model: 'gpt-4.1', label: 'GPT-4.1', capabilities: ['tools'], runtimeOptions: { contextLimit: 1_047_576 } },
            { modelId: 'openai-o4-mini', model: 'o4-mini', label: 'o4-mini', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 200_000 } },
            { modelId: 'openai-o3', model: 'o3', label: 'o3', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 200_000 } },
        ],
    },
    anthropic: {
        id: 'anthropic',
        label: 'Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        envPrefixes: ['ANTHROPIC', 'CLAUDE'],
        defaultModel: {
            modelId: 'anthropic-default',
            model: 'claude-opus-4-7',
            label: 'Claude Opus 4.7',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'anthropic-claude-opus-4-7', model: 'claude-opus-4-7', label: 'Claude Opus 4.7', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-opus-4-6', model: 'claude-opus-4-6', label: 'Claude Opus 4.6', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-sonnet-4-6', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-haiku-4-5', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', capabilities: ['tools'] },
        ],
    },
    kimi: {
        id: 'kimi',
        label: 'Kimi',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.kimi.com/coding/v1',
        envPrefixes: ['KIMI'],
        defaultModel: createKimiK3Variant('kimi-default'),
        availableModels: [
            createKimiK3Variant('kimi-k3'),
            createKimiK3Variant('kimi-k3-256k', 'k3-256k', 'Kimi K3 256K'),
            { modelId: 'kimi-for-coding', model: 'kimi-for-coding', label: 'Kimi for Coding', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 262_144 } },
            // k2.6 / k2.5 只在开放平台 endpoint 上有效；k2.5 官方公告 8/31 下线。
            // 262,144 来自官方定价页给出的精确整数（非按 "256k" 推断）。
            { modelId: 'kimi-k2.6', model: 'kimi-k2.6', label: 'Kimi K2.6', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 262_144 } },
            { modelId: 'kimi-k2.5', model: 'kimi-k2.5', label: 'Kimi K2.5', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 262_144 } },
        ],
    },
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.deepseek.com/v1',
        envPrefixes: ['DEEPSEEK'],
        // 官方明确不支持图片输入（Anthropic 兼容表 / Responses API / chat 参考三处一致），
        // 且默认开启思考模式。contextLimit 来自 https://api-docs.deepseek.com/quick_start/pricing/
        defaultModel: {
            modelId: 'deepseek-default',
            model: 'deepseek-v4-pro',
            label: 'DeepSeek V4 Pro',
            capabilities: ['tools', 'thinking'],
            runtimeOptions: { contextLimit: 1_000_000 },
        },
        availableModels: [
            { modelId: 'deepseek-v4-pro', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 1_000_000 } },
            { modelId: 'deepseek-v4-flash', model: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 1_000_000 } },
        ],
    },
    glm: {
        id: 'glm',
        label: 'GLM',
        protocol: 'openai_legacy',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        envPrefixes: ['GLM'],
        // contextLimit 逐个查证于 https://docs.bigmodel.cn/cn/guide/start/model-overview
        defaultModel: {
            modelId: 'glm-default',
            model: 'GLM-5.2',
            label: 'GLM 5.2',
            capabilities: ['tools'],
            runtimeOptions: { contextLimit: 1_000_000 },
        },
        availableModels: [
            // GLM-5.3（https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3，2026-08-16 查证）：
            // 与 GLM-5.2 同底座，纯 post-training 提升。1M 上下文窗口，128K 最大输出。
            // 思考功能始终启用，不支持 thinking.type: disabled；reasoning_effort 仅
            // low/high/max 三档，默认 max（与 5.2 及以下版本不同，那些没有思考控制）。
            { modelId: 'glm-5.3', model: 'GLM-5.3', label: 'GLM 5.3', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' }, runtimeConstraints: { reasoningEfforts: ['low', 'high', 'max'] } },
            // 与 defaultModel 共享 wireModel，元数据必须逐字一致，否则
            // resolveProviderModelVariant 会抛 MODEL_VARIANT_AMBIGUOUS。
            { modelId: 'glm-5.2', model: 'GLM-5.2', label: 'GLM 5.2', capabilities: ['tools'], runtimeOptions: { contextLimit: 1_000_000 } },
            { modelId: 'glm-5.1', model: 'GLM-5.1', label: 'GLM 5.1', capabilities: ['tools'], runtimeOptions: { contextLimit: 200_000 } },
            { modelId: 'glm-5', model: 'GLM-5', label: 'GLM 5', capabilities: ['tools'], runtimeOptions: { contextLimit: 200_000 } },
            { modelId: 'glm-5-turbo', model: 'GLM-5-Turbo', label: 'GLM 5 Turbo', capabilities: ['tools'], runtimeOptions: { contextLimit: 200_000 } },
            { modelId: 'glm-4.7', model: 'GLM-4.7', label: 'GLM 4.7', capabilities: ['tools'], runtimeOptions: { contextLimit: 200_000 } },
            { modelId: 'glm-4.5', model: 'glm-4.5', label: 'GLM 4.5', capabilities: ['tools'], runtimeOptions: { contextLimit: 128_000 } },
        ],
    },
    minimax: {
        id: 'minimax',
        label: 'MiniMax',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.minimax.io/v1',
        envPrefixes: ['MINIMAX'],
        // Text-01 与 M1 已从官方 model enum 下架，当前旗舰是 M3（原生多模态、
        // 支持 tool use 与 interleaved thinking）。contextLimit 为官方固定值 1,000,000
        // （https://platform.minimax.io/docs/guides/text-generation，无分档条件）。
        defaultModel: {
            modelId: 'minimax-default',
            model: 'MiniMax-M3',
            label: 'MiniMax M3',
            capabilities: ['tools', 'thinking', 'image_in'],
            runtimeOptions: { contextLimit: 1_000_000 },
        },
        availableModels: [
            { modelId: 'minimax-m3', model: 'MiniMax-M3', label: 'MiniMax M3', capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_000_000 } },
        ],
    },
    gemini: {
        id: 'gemini',
        label: 'Gemini',
        protocol: 'openai_responses',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        envPrefixes: ['GEMINI'],
        // contextLimit 来自 https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
        // 与 .../gemini-2.5-flash（两者同为 1,048,576，无 tier 门槛）。
        defaultModel: {
            modelId: 'gemini-default',
            model: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            capabilities: ['tools', 'thinking', 'image_in'],
            runtimeOptions: { contextLimit: 1_048_576 },
        },
        availableModels: [
            // 与 defaultModel 共享 wireModel，元数据必须逐字一致
            { modelId: 'gemini-2.5-pro', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_048_576 } },
            { modelId: 'gemini-2.5-flash', model: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_048_576 } },
        ],
    },
};
export function getProviderProfile(providerId) {
    return PROVIDER_REGISTRY[providerId];
}
function variantMetadataKey(variant) {
    return JSON.stringify({
        capabilities: [...(variant.capabilities ?? [])].sort(),
        runtimeOptions: {
            contextLimit: variant.runtimeOptions?.contextLimit ?? null,
            reasoningEffort: variant.runtimeOptions?.reasoningEffort ?? null,
        },
        runtimeConstraints: {
            maxContextLimit: variant.runtimeConstraints?.maxContextLimit ?? null,
            reasoningEfforts: [...(variant.runtimeConstraints?.reasoningEfforts ?? [])].sort(),
        },
    });
}
const METADATA_FIELDS = ['capabilities', 'runtimeOptions', 'runtimeConstraints'];
/**
 * 指出重复 wireModel 的哪些字段真正不一致。没有这个，守卫在 CI 变红后
 * 还要人工逐行 diff registry 才能找到漏改的那一处。
 */
function divergentMetadataFields(variants) {
    return METADATA_FIELDS.filter((field) => {
        const rendered = new Set(variants.map((variant) => {
            const parsed = JSON.parse(variantMetadataKey(variant));
            return JSON.stringify(parsed[field]);
        }));
        return rendered.size > 1;
    });
}
export function resolveProviderModelVariant(profile, wireModel) {
    const matches = [profile.defaultModel, ...(profile.availableModels ?? [])]
        .filter((variant) => variant.model === wireModel)
        .sort((left, right) => (left.modelId.localeCompare(right.modelId)
        || left.label.localeCompare(right.label)));
    if (matches.length <= 1)
        return matches[0];
    const metadataKeys = new Set(matches.map(variantMetadataKey));
    if (metadataKeys.size > 1) {
        const ids = matches.map((variant) => variant.modelId).join(', ');
        const fields = divergentMetadataFields(matches).join(', ');
        throw Object.assign(new Error(`Ambiguous model variants for ${profile.id}/${wireModel}: `
            + `${ids} disagree on ${fields}`), { code: 'MODEL_VARIANT_AMBIGUOUS' });
    }
    return matches[0];
}
/**
 * Catalog 查询：优先 modelId + wireModel 双键精确匹配，失配时按 wireModel 回退。
 *
 * 回退存在的原因：写入侧会把模型名合成为 `${provider}-${sanitize(wire)}`
 * （Desktop 得到 `glm-glm-5.2`，CLI 得到 `glm-glm-5-2`），两者都不等于 catalog
 * 的 `glm-5.2`，导致 catalog 元数据在双键匹配下永远取不到。回退让这些存量配置
 * 无需迁移即可恢复正确的窗口。
 *
 * 与 resolveProviderModelVariant 的关键区别：**本函数永不抛错**。它被运行时
 * 主路径（control-plane 的绑定解析）调用，registry 数据不一致时必须安静地
 * 退化为「未命中」，而不是让会话崩溃。
 *
 * 调用方必须自行确保只对 first-party provider 使用本函数 —— 否则一个 id 与
 * 官方撞名的 custom provider 会继承官方元数据。
 */
export function findCatalogModel(profile, modelId, wireModel) {
    if (!profile)
        return undefined;
    const variants = [profile.defaultModel, ...(profile.availableModels ?? [])];
    const exact = variants.find((variant) => variant.modelId === modelId && variant.model === wireModel);
    if (exact)
        return exact;
    const byWire = variants.filter((variant) => variant.model === wireModel);
    if (byWire.length === 0)
        return undefined;
    // 元数据不一致时无法确定该采用哪一条，退化为未命中。
    if (new Set(byWire.map(variantMetadataKey)).size > 1)
        return undefined;
    // variantMetadataKey 不含 label / modelId，因此这些条目对元数据而言等价。
    return byWire[0];
}
export function getProviderModelVariant(providerId, wireModel) {
    const profile = getProviderProfile(providerId);
    return profile ? resolveProviderModelVariant(profile, wireModel) : undefined;
}
export function listProviderProfiles() {
    return Object.values(PROVIDER_REGISTRY);
}
