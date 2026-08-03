import { findCatalogModel, getProviderProfile } from '../providers/registry.js';
import { modelCapabilitiesFromFlags } from '../runtime/model-capabilities.js';
/**
 * subagent 换模型时重解析 capability overrides。
 *
 * 规则：**绝不把上一个模型的 contextLimit 带到新模型上**。窗口是逐模型的事实，
 * 沿用它会让「从 1M 模型切到 200K 模型」继续按 1M 压缩，直接超窗。
 *
 * - first-party：按新 wireModel 从目录重查（`findCatalogModel` 永不抛错）。
 * - 其余情况：保留与模型无关的标记，但剥掉 `contextLimit`，让新模型回落到
 *   `inferModelCapabilities` 的判断。
 *
 * first-party 闸门与 `control-plane.resolveRuntimeModelBinding` 同一条规则：
 * `getProviderProfile` 只按 id 查表，所以 id 与官方撞名的 custom provider
 * 不得继承官方目录元数据。
 */
export function resolveClonedCapabilityOverrides(wireModel, current, identity) {
    if (identity?.providerType === 'first_party') {
        const variant = findCatalogModel(getProviderProfile(identity.providerId), wireModel, wireModel);
        if (variant) {
            return {
                ...modelCapabilitiesFromFlags(variant.capabilities),
                ...(variant.runtimeOptions?.contextLimit !== undefined
                    ? { contextLimit: variant.runtimeOptions.contextLimit }
                    : {}),
            };
        }
    }
    if (!current)
        return undefined;
    const { contextLimit: _dropped, ...modelAgnostic } = current;
    return Object.keys(modelAgnostic).length > 0 ? modelAgnostic : undefined;
}
