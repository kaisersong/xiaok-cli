import * as readline from 'node:readline';
import { loadConfig, saveConfig } from '../utils/config.js';
import { listProviderProfiles } from '../ai/providers/registry.js';
import { listCandidateApiKeys } from '../ai/providers/auth-resolver.js';
import { probeApiKey } from '../ai/providers/key-probe.js';
import { writeLine } from '../utils/ui.js';
import { getProviderLoginPlans } from '../ai/providers/login-plans.js';
import { pauseInputForHandoff, retainRawInputModeForSession } from '../ui/input-mode.js';
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
class LoginCancelledError extends Error {
}
function prompt(question, cancellation) {
    cancellation?.signal.throwIfAborted();
    if (typeof process.stdin.setRawMode === 'function')
        return readRawPrompt(question, false, cancellation);
    if (process.stdin.readableEnded)
        return Promise.reject(new LoginCancelledError());
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        let settled = false;
        const finish = (answer, error) => {
            if (settled)
                return;
            settled = true;
            cancellation?.signal.removeEventListener('abort', abort);
            rl.removeListener('SIGINT', interrupt);
            rl.removeListener('close', close);
            try {
                rl.close();
            }
            catch (cleanupError) {
                reject(error === undefined ? cleanupError : new AggregateError([error, cleanupError], 'login_prompt_cleanup_failed'));
                return;
            }
            if (error !== undefined)
                reject(error);
            else
                resolve(answer.trim());
        };
        const abort = () => finish(undefined, cancellation.signal.reason);
        const close = () => finish(undefined, new LoginCancelledError());
        const interrupt = () => {
            try {
                cancellation?.onInterrupt?.();
                finish(undefined, cancellation?.signal.aborted ? cancellation.signal.reason : new LoginCancelledError());
            }
            catch (error) {
                finish(undefined, error);
            }
        };
        rl.once('SIGINT', interrupt);
        rl.once('close', close);
        cancellation?.signal.addEventListener('abort', abort, { once: true });
        if (cancellation?.signal.aborted) {
            abort();
            return;
        }
        if (process.stdin.readableEnded) {
            close();
            return;
        }
        try {
            rl.question(question, answer => finish(answer));
        }
        catch (error) {
            finish(undefined, error);
        }
    });
}
/** Consume every character because terminals may coalesce paste + Enter. */
export function consumeSecretInputChunk(value, chunk) {
    let nextValue = value;
    for (const character of Array.from(chunk.toString('utf8'))) {
        if (character === '\r' || character === '\n') {
            return { action: 'submit', value: nextValue };
        }
        if (character === '\u0003' || character === '\u0004') {
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
function promptSecret(question, cancellation) {
    return readRawPrompt(question, true, cancellation);
}
function readRawPrompt(question, hidden, cancellation) {
    cancellation?.signal.throwIfAborted();
    const stdin = process.stdin;
    if (typeof stdin.setRawMode !== 'function')
        return prompt(question, cancellation);
    if (stdin.readableEnded)
        return Promise.reject(new LoginCancelledError());
    return new Promise((resolve, reject) => {
        let value = '';
        const wasRaw = Boolean(stdin.isRaw);
        let finished = false;
        const finish = (error) => {
            if (finished)
                return;
            finished = true;
            const answer = error === undefined ? value.trim() : '';
            value = '';
            stdin.removeListener('data', onData);
            stdin.removeListener('end', onEnd);
            cancellation?.signal.removeEventListener('abort', onAbort);
            const errors = error === undefined ? [] : [error];
            try {
                pauseInputForHandoff();
            }
            catch (cleanupError) {
                errors.push(cleanupError);
            }
            // An enclosing Windows session retains raw mode between prompts. An
            // external raw owner must also keep its exact prior mode on cancellation.
            if (wasRaw) {
                try {
                    stdin.setRawMode(true);
                }
                catch (cleanupError) {
                    errors.push(cleanupError);
                }
            }
            try {
                process.stdout.write('\n');
            }
            catch (cleanupError) {
                errors.push(cleanupError);
            }
            if (errors.length === 1)
                reject(errors[0]);
            else if (errors.length)
                reject(new AggregateError(errors, 'login_prompt_cleanup_failed'));
            else
                resolve(answer);
        };
        const onAbort = () => finish(cancellation.signal.reason);
        const onEnd = () => finish(cancellation?.signal.aborted ? cancellation.signal.reason : new LoginCancelledError());
        const interrupt = () => {
            try {
                cancellation?.onInterrupt?.();
                finish(cancellation?.signal.aborted ? cancellation.signal.reason : new LoginCancelledError());
            }
            catch (error) {
                finish(error);
            }
        };
        const onData = (chunk) => {
            try {
                for (const character of chunk.toString('utf8')) {
                    if (finished)
                        return;
                    const previous = value;
                    const result = consumeSecretInputChunk(value, Buffer.from(character));
                    value = result.value;
                    if (result.action === 'submit') {
                        finish();
                        return;
                    }
                    if (result.action === 'abort') {
                        if (character === '\u0003')
                            interrupt();
                        else
                            onEnd();
                        return;
                    }
                    if (!hidden) {
                        if (value.length < previous.length)
                            process.stdout.write('\b \b');
                        else if (value.length > previous.length)
                            process.stdout.write(character);
                    }
                }
            }
            catch (error) {
                finish(error);
            }
        };
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        cancellation?.signal.addEventListener('abort', onAbort, { once: true });
        if (cancellation?.signal.aborted) {
            onAbort();
            return;
        }
        if (stdin.readableEnded) {
            onEnd();
            return;
        }
        try {
            process.stdout.write(question);
            stdin.setRawMode(true);
            stdin.resume();
        }
        catch (error) {
            finish(error);
        }
    });
}
export async function runLoginCommand(options, cancellation) {
    const current = () => cancellation?.signal.throwIfAborted();
    current();
    const config = await loadConfig();
    current();
    const profiles = listProviderProfiles();
    const interactive = Boolean(process.stdin.isTTY);
    const releaseRawInput = retainRawInputModeForSession();
    const persist = async () => {
        current();
        const original = saveConfig(config);
        try {
            cancellation?.trackWrite?.(original);
        }
        catch (trackingError) {
            const [result] = await Promise.allSettled([original]);
            throw new AggregateError([trackingError, ...(result.status === 'rejected' ? [result.reason] : [])], 'login_write_tracking_failed');
        }
        await original;
        current();
    };
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
            const answer = await prompt('输入编号或 provider id：', cancellation);
            current();
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
        const plans = getProviderLoginPlans(chosen.id);
        let planId = options.plan?.trim().toLowerCase();
        if (!planId && interactive && plans.length > 0) {
            writeLine('选择 Key 所属服务（普通 API 与 Coding Plan 的 Key/额度可能不通用）：');
            plans.forEach((plan, index) => writeLine(`  ${index + 1}. ${plan.label} (${plan.id})`));
            const answer = await prompt('输入编号或服务 id：', cancellation);
            current();
            planId = plans[Number(answer) - 1]?.id ?? answer.toLowerCase();
        }
        const plan = plans.find(item => item.id === planId);
        if (planId !== undefined && !plan) {
            writeLine(`不支持的服务：${planId}。可用：${plans.map(item => item.id).join(', ') || '标准 API'}`);
            return { status: 'cancelled' };
        }
        const existing = config.providers[chosen.id];
        const baseUrl = options.baseUrl?.trim() || plan?.baseUrl || existing?.baseUrl || chosen.baseUrl;
        const defaultModel = plan?.defaultModel ?? chosen.defaultModel;
        // 2. portal hint + existing env candidates
        const portal = plan?.keyPortal ?? (chosen.id === 'kimi' && baseUrl?.includes('/coding') ? 'https://www.kimi.com/code/console' : KEY_PORTAL_HINTS[chosen.id]);
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
            apiKey = await promptSecret(`输入 ${chosen.label} API key（${envCandidates.length > 0 ? '回车复用环境变量中的 key' : '输入时不可见'}）：`, cancellation);
            current();
            if (!apiKey && envCandidates.length > 0) {
                apiKey = envCandidates[0].apiKey;
            }
        }
        if (!apiKey) {
            writeLine('未输入 key，已取消。');
            return { status: 'cancelled' };
        }
        // 4. optional live verification (explicit opt-out only skips network)
        current();
        if (!options.skipVerify) {
            writeLine('正在验证 key（只读模型列表请求，不消耗生成 token）…');
            const probe = await probeApiKey(chosen.protocol, baseUrl, apiKey);
            current();
            if (probe.status === 'valid') {
                writeLine('验证通过。');
            }
            else if (probe.status === 'network_error') {
                writeLine(`暂未验证通过（${probe.detail ?? probe.httpStatus ?? '网络不可达'}）；将保存配置，可稍后用 xiaok doctor --check-keys 复查。`);
            }
            else if (probe.status === 'unknown_protocol') {
                writeLine('该 provider 协议暂不支持在线验证，key 已保存。');
            }
            else {
                writeLine(`验证失败（${probe.detail ?? probe.httpStatus ?? 'invalid'}）。请检查 Key 是否属于所选服务以及访问权限；key 仍会保存，可重新运行 xiaok login。`);
            }
        }
        // 5. persist
        config.providers = config.providers ?? {};
        config.providers[chosen.id] = {
            type: 'first_party',
            protocol: chosen.protocol,
            ...(baseUrl ? { baseUrl } : {}),
            ...(existing?.headers ? { headers: existing.headers } : {}),
            apiKey,
        };
        await persist();
        writeLine(`已保存 ${chosen.label} API key 到 ${chosen.id} provider。`);
        // 6. default model switch — non-interactive default is no (safe);
        //    interactive runs ask.
        const setDefault = options.setDefault
            ?? (interactive
                ? (await prompt(`切换默认模型到 ${defaultModel.label}？(y/N)：`, cancellation)).toLowerCase() === 'y'
                : false);
        current();
        if (setDefault) {
            config.models = config.models ?? {};
            const modelId = defaultModel.modelId;
            if (plan || !config.models[modelId]) {
                config.models[modelId] = {
                    provider: chosen.id,
                    model: defaultModel.model,
                    label: defaultModel.label,
                    ...(defaultModel.capabilities ? { capabilities: [...defaultModel.capabilities] } : {}),
                    ...(defaultModel.runtimeOptions
                        ? { runtimeOptions: { ...defaultModel.runtimeOptions } }
                        : {}),
                };
            }
            config.defaultProvider = chosen.id;
            config.defaultModelId = modelId;
            await persist();
            writeLine(`默认模型已切换为 [${chosen.id}] ${defaultModel.label}。`);
        }
        writeLine('完成。运行 xiaok chat 开始使用。');
        return { status: 'saved', providerId: chosen.id };
    }
    catch (error) {
        if (error instanceof LoginCancelledError)
            return { status: 'cancelled' };
        throw error;
    }
    finally {
        releaseRawInput();
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
        .option('--plan <id>', 'Key 所属服务：api 或 coding（Kimi/GLM/MiniMax）')
        .option('--base-url <url>', '覆盖所选服务地址（国际服务或自定义代理）')
        .action(async (opts) => {
        await runLoginCommand(opts);
    });
}
