import { resolveClonedCapabilityOverrides } from './catalog-identity.js';
import { systemOneEndpointUrl } from '../providers/system-one-config.js';
/**
 * TypeSafe System One 决策模型（Jev）适配器。
 *
 * 与普通 chat 模型不同，System One 走 `POST <base>/v1/systemone`：
 * 请求体是 `{ model, state, questions }`，响应是 `{ answers, usage }`，
 * 不经过 `/chat/completions`，所以不能复用 OpenAI SDK。
 *
 * 与 ModelAdapter 契约的映射：
 * - `state` ← 最后一条 user 消息的全部 text block（无则回退 systemPrompt）；
 * - 有 tools → 一个 `choice` 问题（criteria = 工具名 → 描述），选中的工具名转成 tool_use；
 * - 无 tools → 一个 `noul` 问题（instructions = state），概率作为文本增量返回。
 */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CHOICE_CRITERIA = 255;
function joinTextBlocks(message) {
    if (!message)
        return '';
    return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .filter(Boolean)
        .join('\n')
        .trim();
}
/** 取最后一条非空 user 文本；没有 user 文本时回退 systemPrompt。 */
export function extractSystemOneState(messages, systemPrompt) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'user')
            continue;
        const text = joinTextBlocks(message);
        if (text)
            return text;
    }
    return systemPrompt.trim();
}
export function buildSystemOneQuestions(tools, state) {
    if (tools.length > 0) {
        const criteria = {};
        for (const tool of tools.slice(0, MAX_CHOICE_CRITERIA)) {
            criteria[tool.name] = tool.description || tool.name;
        }
        return {
            next: {
                type: 'choice',
                instructions: 'Which tool should handle the state?',
                criteria,
            },
        };
    }
    return {
        answer: {
            type: 'noul',
            instructions: state || 'The state is complete.',
        },
    };
}
export function buildSystemOneRequest(model, messages, tools, systemPrompt) {
    const state = extractSystemOneState(messages, systemPrompt);
    return {
        model,
        state,
        questions: buildSystemOneQuestions(tools, state),
    };
}
function formatAnswer(name, answer) {
    if (typeof answer.noul === 'number') {
        return answer.confidence === undefined
            ? `${name}: noul=${answer.noul}`
            : `${name}: noul=${answer.noul} (confidence ${answer.confidence})`;
    }
    const picked = answer.choice ?? answer.score ?? '';
    if (!picked)
        return '';
    return answer.confidence === undefined
        ? `${name}: ${picked}`
        : `${name}: ${picked} (confidence ${answer.confidence})`;
}
export class SystemOneAdapter {
    apiKey;
    baseUrl;
    defaultHeaders;
    capabilityOverrides;
    catalogIdentity;
    model;
    constructor(init) {
        this.apiKey = init.apiKey;
        this.baseUrl = init.baseUrl;
        this.model = init.model;
        this.defaultHeaders = init.headers;
        this.capabilityOverrides = init.capabilityOverrides;
        this.catalogIdentity = init.catalogIdentity;
    }
    getModelName() {
        return this.model;
    }
    getCapabilities() {
        return this.capabilityOverrides ?? {};
    }
    cloneWithModel(model) {
        return new SystemOneAdapter({
            apiKey: this.apiKey,
            baseUrl: this.baseUrl,
            model,
            headers: this.defaultHeaders,
            capabilityOverrides: resolveClonedCapabilityOverrides(model, this.capabilityOverrides, this.catalogIdentity),
            catalogIdentity: this.catalogIdentity,
        });
    }
    endpoint() {
        return systemOneEndpointUrl(this.baseUrl);
    }
    async *stream(messages, tools, systemPrompt, options) {
        const body = buildSystemOneRequest(this.model, messages, tools, systemPrompt);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        // 与其它适配器一致：调用方传入已 abort 的信号时必须立刻生效，
        // 而不是等一个永远不会再触发的 abort 事件。
        const signal = options?.signal
            ? AbortSignal.any([controller.signal, options.signal])
            : controller.signal;
        let resp;
        try {
            resp = await fetch(this.endpoint(), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(this.defaultHeaders ?? {}),
                },
                body: JSON.stringify(body),
                signal,
            });
        }
        catch (error) {
            clearTimeout(timer);
            // 调用方主动取消时透传原始原因；超时才包装成可读错误。
            if (options?.signal?.aborted)
                throw error;
            throw new Error(`System One 请求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        clearTimeout(timer);
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            throw new Error(`System One 请求失败 (${resp.status})${detail ? `: ${detail}` : ''}`);
        }
        const result = (await resp.json());
        const answers = result.answers ?? {};
        const lines = [];
        for (const [name, answer] of Object.entries(answers)) {
            const line = formatAnswer(name, answer);
            if (line)
                lines.push(line);
        }
        if (lines.length > 0) {
            yield { type: 'text', delta: lines.join('\n') };
        }
        const chosen = answers.next?.choice;
        if (chosen) {
            yield { type: 'tool_use', id: `so-${Date.now()}`, name: chosen, input: {} };
        }
        if (result.usage) {
            yield {
                type: 'usage',
                usage: {
                    inputTokens: result.usage.input_tokens ?? 0,
                    outputTokens: result.usage.output_tokens ?? 0,
                },
            };
        }
        yield { type: 'done' };
    }
}
