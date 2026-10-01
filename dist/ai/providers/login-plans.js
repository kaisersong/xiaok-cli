import { getProviderModelVariant, getProviderProfile } from './registry.js';
/** Plan selection belongs to credential setup; runtime uses the saved endpoint. */
export function getProviderLoginPlans(providerId) {
    const profile = getProviderProfile(providerId);
    if (!profile)
        return [];
    if (providerId === 'kimi')
        return [
            { id: 'coding', label: 'Kimi Coding Plan（会员订阅）', baseUrl: 'https://api.kimi.com/coding/v1', keyPortal: 'https://www.kimi.com/code/console', defaultModel: profile.defaultModel },
            { id: 'api', label: 'Kimi 开放平台 API（按量计费）', baseUrl: 'https://api.moonshot.cn/v1', keyPortal: 'https://platform.moonshot.cn/console/api-keys', defaultModel: getProviderModelVariant('kimi', 'kimi-k2.6') },
        ];
    if (providerId === 'glm')
        return [
            { id: 'coding', label: 'GLM Coding Plan（编码套餐）', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', keyPortal: 'https://www.bigmodel.cn/console/overview', defaultModel: getProviderModelVariant('glm', 'GLM-5.3') },
            { id: 'api', label: 'GLM 标准 API（按量计费）', baseUrl: profile.baseUrl, keyPortal: 'https://open.bigmodel.cn/usercenter/apikeys', defaultModel: profile.defaultModel },
        ];
    if (providerId === 'minimax')
        return [
            { id: 'coding', label: 'MiniMax Coding / Token Plan（订阅 Key）', baseUrl: profile.baseUrl, keyPortal: 'https://platform.minimax.io/subscribe/coding-plan', defaultModel: profile.defaultModel },
            { id: 'api', label: 'MiniMax 标准 API（按量计费 Key）', baseUrl: profile.baseUrl, keyPortal: 'https://platform.minimax.io/user-center/basic-information/interface-key', defaultModel: profile.defaultModel },
        ];
    return [];
}
