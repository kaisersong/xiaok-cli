import { loadConfig, saveConfig } from '../utils/config.js';
import { getProviderProfile } from '../ai/providers/registry.js';
function normalizeProviderId(value) {
    if (value === 'claude')
        return 'anthropic';
    if (value === 'anthropic')
        return 'anthropic';
    if (value === 'openai')
        return 'openai';
    if (value === 'custom')
        return 'custom-default';
    if (value === 'kimi' || value === 'deepseek' || value === 'glm' || value === 'minimax' || value === 'gemini') {
        return value;
    }
    return null;
}
function sanitizeModelIdPart(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function ensureProviderConfig(cfg, providerId) {
    if (cfg.providers[providerId]) {
        return;
    }
    if (providerId === 'custom-default') {
        cfg.providers[providerId] = {
            type: 'custom',
            protocol: 'openai_legacy',
        };
        return;
    }
    const profile = getProviderProfile(providerId);
    if (!profile) {
        throw new Error(`未知 provider: ${providerId}`);
    }
    cfg.providers[providerId] = {
        type: 'first_party',
        protocol: profile.protocol,
        baseUrl: profile.baseUrl,
        headers: profile.defaultHeaders,
    };
}
function ensureDefaultModelForProvider(cfg, providerId) {
    const existing = Object.entries(cfg.models).find(([, model]) => model.provider === providerId);
    if (existing) {
        return existing[0];
    }
    if (providerId === 'custom-default') {
        const modelId = 'custom-default-model';
        cfg.models[modelId] = {
            provider: providerId,
            model: 'default',
            label: 'Custom Default',
        };
        return modelId;
    }
    const profile = getProviderProfile(providerId);
    if (!profile) {
        throw new Error(`未知 provider: ${providerId}`);
    }
    cfg.models[profile.defaultModel.modelId] = {
        provider: providerId,
        model: profile.defaultModel.model,
        label: profile.defaultModel.label,
        capabilities: profile.defaultModel.capabilities,
    };
    return profile.defaultModel.modelId;
}
export function registerConfigCommands(program) {
    const config = program.command('config').description('管理 xiaok 配置');
    const configSet = config.command('set').description('设置配置项');
    configSet
        .command('model <value>')
        .description('设置默认 AI 模型（provider、modelId 或 provider/model）')
        .option('--base-url <url>', '自定义模型 base URL（model=custom 时使用）')
        .option('--api-key <key>', '同时设置该模型的 API Key')
        .action(async (value, opts) => {
        const cfg = await loadConfig();
        if (cfg.models[value]) {
            const model = cfg.models[value];
            cfg.defaultModelId = value;
            cfg.defaultProvider = model.provider;
            await saveConfig(cfg);
            console.log(`已设置默认模型为: ${value}`);
            return;
        }
        const normalizedProvider = normalizeProviderId(value);
        if (normalizedProvider) {
            ensureProviderConfig(cfg, normalizedProvider);
            if (opts.baseUrl) {
                cfg.providers[normalizedProvider].baseUrl = opts.baseUrl;
            }
            if (opts.apiKey) {
                cfg.providers[normalizedProvider].apiKey = opts.apiKey;
            }
            const modelId = ensureDefaultModelForProvider(cfg, normalizedProvider);
            cfg.defaultProvider = normalizedProvider;
            cfg.defaultModelId = modelId;
            await saveConfig(cfg);
            console.log(`已设置默认模型为: ${modelId}`);
            return;
        }
        const [providerValue, modelName] = value.split('/');
        const providerId = normalizeProviderId(providerValue);
        if (providerId && modelName) {
            ensureProviderConfig(cfg, providerId);
            if (providerId === 'custom-default' && !opts.baseUrl && !cfg.providers[providerId].baseUrl) {
                console.error('请先设置 baseUrl：xiaok config set model custom --base-url <url>');
                return;
            }
            if (opts.baseUrl) {
                cfg.providers[providerId].baseUrl = opts.baseUrl;
            }
            if (opts.apiKey) {
                cfg.providers[providerId].apiKey = opts.apiKey;
            }
            const modelId = `${providerId}-${sanitizeModelIdPart(modelName)}`;
            cfg.models[modelId] = {
                provider: providerId,
                model: modelName,
                label: modelName,
            };
            cfg.defaultProvider = providerId;
            cfg.defaultModelId = modelId;
            await saveConfig(cfg);
            console.log(`已设置默认模型为: ${modelId}`);
            return;
        }
        console.error(`未知模型: ${value}。支持: modelId、provider、provider/model`);
    });
    configSet
        .command('api-key <key>')
        .description('设置 AI 模型 API Key')
        .option('--provider <provider>', '指定提供商（默认当前默认模型）')
        .action(async (key, opts) => {
        const cfg = await loadConfig();
        const provider = normalizeProviderId(opts.provider ?? cfg.defaultProvider) ?? cfg.defaultProvider;
        ensureProviderConfig(cfg, provider);
        if (provider === 'custom-default' && !cfg.providers[provider].baseUrl) {
            console.error('请先设置 baseUrl：xiaok config set model custom --base-url <url>');
            return;
        }
        cfg.providers[provider].apiKey = key;
        await saveConfig(cfg);
        console.log(`已为 ${provider} 设置 API Key`);
    });
    configSet
        .command('default-model <modelId>')
        .description('设置默认模型 ID')
        .action(async (modelId) => {
        const cfg = await loadConfig();
        const model = cfg.models[modelId];
        if (!model) {
            console.error(`未知模型: ${modelId}`);
            return;
        }
        cfg.defaultModelId = modelId;
        cfg.defaultProvider = model.provider;
        await saveConfig(cfg);
        console.log(`已设置默认模型为: ${modelId}`);
    });
    configSet
        .command('yzj-webhook-url <url>')
        .description('设置云之家 webhookUrl')
        .action(async (url) => {
        const cfg = await loadConfig();
        cfg.channels = cfg.channels ?? {};
        cfg.channels.yzj = {
            ...(cfg.channels.yzj ?? {}),
            webhookUrl: url,
        };
        await saveConfig(cfg);
        console.log('已设置 channels.yzj.webhookUrl');
    });
    configSet
        .command('yzj-inbound-mode <mode>')
        .description('设置云之家入站模式（webhook / websocket）')
        .action(async (mode) => {
        if (mode !== 'webhook' && mode !== 'websocket') {
            console.error('inbound-mode 仅支持 webhook 或 websocket');
            return;
        }
        const cfg = await loadConfig();
        cfg.channels = cfg.channels ?? {};
        cfg.channels.yzj = {
            ...(cfg.channels.yzj ?? {}),
            inboundMode: mode,
        };
        await saveConfig(cfg);
        console.log(`已设置 channels.yzj.inboundMode = ${mode}`);
    });
    configSet
        .command('yzj-webhook-path <path>')
        .description('设置云之家 webhook 路径')
        .action(async (path) => {
        const cfg = await loadConfig();
        cfg.channels = cfg.channels ?? {};
        cfg.channels.yzj = {
            ...(cfg.channels.yzj ?? {}),
            webhookPath: path,
        };
        await saveConfig(cfg);
        console.log(`已设置 channels.yzj.webhookPath = ${path}`);
    });
    configSet
        .command('yzj-webhook-port <port>')
        .description('设置云之家 webhook 监听端口')
        .action(async (port) => {
        const parsed = Number(port);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            console.error('webhook-port 必须是正整数');
            return;
        }
        const cfg = await loadConfig();
        cfg.channels = cfg.channels ?? {};
        cfg.channels.yzj = {
            ...(cfg.channels.yzj ?? {}),
            webhookPort: parsed,
        };
        await saveConfig(cfg);
        console.log(`已设置 channels.yzj.webhookPort = ${parsed}`);
    });
    configSet
        .command('yzj-secret <secret>')
        .description('设置云之家 webhook 签名 secret')
        .action(async (secret) => {
        const cfg = await loadConfig();
        cfg.channels = cfg.channels ?? {};
        cfg.channels.yzj = {
            ...(cfg.channels.yzj ?? {}),
            secret,
        };
        await saveConfig(cfg);
        console.log('已设置 channels.yzj.secret');
    });
    config
        .command('get <key>')
        .description('获取配置项（如 model）')
        .action(async (key) => {
        const cfg = await loadConfig();
        if (key === 'model') {
            const m = cfg.models[cfg.defaultModelId];
            console.log(`${cfg.defaultModelId}${m ? ` (${m.provider}/${m.model})` : ''}`);
        }
        else if (key === 'models') {
            console.log(JSON.stringify(cfg.models, null, 2));
        }
        else if (key === 'providers') {
            console.log(JSON.stringify(cfg.providers, null, 2));
        }
        else if (key === 'yzj') {
            console.log(JSON.stringify(cfg.channels?.yzj ?? null, null, 2));
        }
        else if (key === 'yzj.webhook-url') {
            console.log(cfg.channels?.yzj?.webhookUrl ?? '');
        }
        else if (key === 'yzj.inbound-mode') {
            console.log(cfg.channels?.yzj?.inboundMode ?? '');
        }
        else if (key === 'yzj.webhook-path') {
            console.log(cfg.channels?.yzj?.webhookPath ?? '');
        }
        else if (key === 'yzj.webhook-port') {
            console.log(cfg.channels?.yzj?.webhookPort ?? '');
        }
        else {
            console.log(JSON.stringify(cfg[key] ?? null, null, 2));
        }
    });
}
