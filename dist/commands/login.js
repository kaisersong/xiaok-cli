import * as readline from 'node:readline';
import { loadConfig, saveConfig } from '../utils/config.js';
import { listProviderProfiles } from '../ai/providers/registry.js';
import { listCandidateApiKeys } from '../ai/providers/auth-resolver.js';
import { probeApiKey } from '../ai/providers/key-probe.js';
import { writeLine } from '../utils/ui.js';
/** Provider → where users create an API key. Registry has no portal field,
 *  so the mapping lives here next to its only consumer. */
const KEY_PORTAL_HINTS = {
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    kimi: 'https://platform.moonshot.cn/console/api-keys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    glm: 'https://open.bigmodel.cn/usercenter/apikeys',
    minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    gemini: 'https://aistudio.google.com/app/apikey',
};
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}
/** Consume every character because terminals may coalesce paste + Enter. */
export function consumeSecretInputChunk(value, chunk) {
    let nextValue = value;
    for (const character of Array.from(chunk.toString('utf8'))) {
        if (character === '\r' || character === '\n') {
            return { action: 'submit', value: nextValue };
        }
        if (character === '\u0003') {
            return { action: 'abort', value: nextValue };
        }
        if (character === '\u007f' || character === '\b') {
            if (nextValue.length > 0)
                nextValue = nextValue.slice(0, -1);
            continue;
        }
        nextValue += character;
    }
    return { action: 'continue', value: nextValue };
}
/** Hidden input: raw-mode char capture so the key is never echoed. */
function promptSecret(rl, question) {
    return new Promise((resolve) => {
        const stdin = rl.input;
        if (typeof stdin.setRawMode !== 'function') {
            // non-TTY (piped stdin): fall back to a plain line read
            prompt(rl, question).then(resolve);
            return;
        }
        process.stdout.write(question);
        let value = '';
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        const onData = (ch) => {
            const result = consumeSecretInputChunk(value, ch);
            value = result.value;
            if (result.action === 'submit') {
                stdin.setRawMode(wasRaw ?? false);
                stdin.removeListener('data', onData);
                process.stdout.write('\n');
                resolve(value.trim());
            }
            else if (result.action === 'abort') {
                stdin.setRawMode(wasRaw ?? false);
                stdin.removeListener('data', onData);
                process.stdout.write('\n');
                process.exit(130);
            }
        };
        stdin.on('data', onData);
    });
}
export async function runLoginCommand(options) {
    const config = await loadConfig();
    const profiles = listProviderProfiles();
    const interactive = Boolean(process.stdin.isTTY);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: interactive,
    });
    try {
        // 1. provider selection
        let providerId = options.provider?.trim().toLowerCase() ?? '';
        const profile = profiles.find((item) => item.id === providerId);
        if (!profile) {
            if (providerId) {
                writeLine(`未知 provider：${providerId}。可用：${profiles.map((item) => item.id).join(', ')}`);
                return { status: 'cancelled' };
            }
            if (!interactive) {
                writeLine('非交互模式需要 --provider <id>（可用：'
                    + profiles.map((item) => item.id).join(', ') + '）与 --api-key <key>。');
                return { status: 'cancelled' };
            }
            writeLine('选择要配置的 AI provider：');
            profiles.forEach((item, index) => {
                writeLine(`  ${index + 1}. ${item.label} (${item.id})`);
            });
            const answer = await prompt(rl, '输入编号或 provider id：');
            const index = Number(answer) - 1;
            const selected = Number.isInteger(index) && index >= 0 && index < profiles.length
                ? profiles[index]
                : profiles.find((item) => item.id === answer.toLowerCase());
            if (!selected) {
                writeLine('已取消。');
                return { status: 'cancelled' };
            }
            providerId = selected.id;
        }
        const chosen = profiles.find((item) => item.id === providerId);
        // 2. portal hint + existing env candidates
        const portal = KEY_PORTAL_HINTS[chosen.id];
        if (portal) {
            writeLine(`获取 API key：${portal}`);
        }
        const envCandidates = listCandidateApiKeys(config, chosen.id)
            .filter((candidate) => candidate.source !== 'config');
        for (const candidate of envCandidates) {
            writeLine(`检测到环境变量 ${candidate.envVarName} 中的现有 key，可直接回车复用。`);
            break;
        }
        // 3. key entry — non-interactive runs reuse env candidates directly;
        //    a fully missing key fails closed instead of hanging on stdin.
        let apiKey = options.apiKey?.trim() ?? '';
        if (!apiKey && (!interactive || envCandidates.length > 0)) {
            if (envCandidates.length > 0) {
                apiKey = envCandidates[0].apiKey;
            }
            else {
                writeLine('非交互模式需要 --api-key <key>（或先设置对应环境变量）。');
                return { status: 'cancelled' };
            }
        }
        if (!apiKey) {
            apiKey = await promptSecret(rl, `输入 ${chosen.label} API key（${envCandidates.length > 0 ? '回车复用环境变量中的 key' : '输入时不可见'}）：`);
            if (!apiKey && envCandidates.length > 0) {
                apiKey = envCandidates[0].apiKey;
            }
        }
        if (!apiKey) {
            writeLine('未输入 key，已取消。');
            return { status: 'cancelled' };
        }
        // 4. optional live verification (explicit opt-out only skips network)
        if (!options.skipVerify) {
            writeLine('正在验证 key（只读模型列表请求，不消耗生成 token）…');
            const probe = await probeApiKey(chosen.protocol, chosen.baseUrl, apiKey);
            if (probe.status === 'valid') {
                writeLine('验证通过。');
            }
            else if (probe.status === 'network_error') {
                writeLine('网络不可达，跳过验证（key 已保存，可稍后用 xiaok doctor --check-keys 复查）。');
            }
            else if (probe.status === 'unknown_protocol') {
                writeLine('该 provider 协议暂不支持在线验证，key 已保存。');
            }
            else {
                writeLine(`验证失败（${probe.detail ?? probe.httpStatus ?? 'invalid'}）。key 仍会保存；如确认输错可重新运行 xiaok login。`);
            }
        }
        // 5. persist
        config.providers = config.providers ?? {};
        const existing = config.providers[chosen.id];
        config.providers[chosen.id] = {
            type: 'first_party',
            protocol: chosen.protocol,
            ...(chosen.baseUrl ? { baseUrl: chosen.baseUrl } : {}),
            ...(existing?.baseUrl ? { baseUrl: existing.baseUrl } : {}),
            ...(existing?.headers ? { headers: existing.headers } : {}),
            apiKey,
        };
        await saveConfig(config);
        writeLine(`已保存 ${chosen.label} API key 到 ${chosen.id} provider。`);
        // 6. default model switch — non-interactive default is no (safe);
        //    interactive runs ask.
        const setDefault = options.setDefault
            ?? (interactive
                ? (await prompt(rl, `切换默认模型到 ${chosen.defaultModel.label}？(y/N)：`)).toLowerCase() === 'y'
                : false);
        if (setDefault) {
            config.models = config.models ?? {};
            const modelId = chosen.defaultModel.modelId;
            if (!config.models[modelId]) {
                config.models[modelId] = {
                    provider: chosen.id,
                    model: chosen.defaultModel.model,
                    label: chosen.defaultModel.label,
                    ...(chosen.defaultModel.capabilities ? { capabilities: [...chosen.defaultModel.capabilities] } : {}),
                    ...(chosen.defaultModel.runtimeOptions
                        ? { runtimeOptions: { ...chosen.defaultModel.runtimeOptions } }
                        : {}),
                };
            }
            config.defaultProvider = chosen.id;
            config.defaultModelId = modelId;
            await saveConfig(config);
            writeLine(`默认模型已切换为 [${chosen.id}] ${chosen.defaultModel.label}。`);
        }
        writeLine('完成。运行 xiaok chat 开始使用。');
        return { status: 'saved', providerId: chosen.id };
    }
    finally {
        rl.close();
    }
}
export function registerLoginCommand(program) {
    program
        .command('login')
        .description('配置 AI provider 的 API key（首次使用引导入口）')
        .option('--provider <id>', 'provider id（openai/anthropic/kimi/deepseek/glm/minimax/gemini）')
        .option('--api-key <key>', 'API key（省略则进入交互输入；配合 --provider 用于脚本化）')
        .option('--set-default', '验证后直接把默认模型切换到该 provider，不再询问')
        .option('--skip-verify', '跳过在线 key 验证（不发网络请求）')
        .action(async (opts) => {
        await runLoginCommand(opts);
    });
}
