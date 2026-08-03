import type { ProviderModelVariant, ProviderProfile } from './types.js';
export declare function getProviderProfile(providerId: string): ProviderProfile | undefined;
export declare function resolveProviderModelVariant(profile: ProviderProfile, wireModel: string): ProviderModelVariant | undefined;
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
export declare function findCatalogModel(profile: ProviderProfile | undefined, modelId: string, wireModel: string): ProviderModelVariant | undefined;
export declare function getProviderModelVariant(providerId: string, wireModel: string): ProviderModelVariant | undefined;
export declare function listProviderProfiles(): ProviderProfile[];
