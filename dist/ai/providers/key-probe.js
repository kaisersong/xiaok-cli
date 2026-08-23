const PROBE_TIMEOUT_MS = 8_000;
const ANTHROPIC_VERSION = '2023-06-01';
function buildProbeRequest(protocol, baseUrl, apiKey) {
    if (protocol === 'anthropic') {
        const base = baseUrl ?? 'https://api.anthropic.com';
        return {
            url: `${base.replace(/\/+$/, '')}/v1/models?limit=1`,
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
            },
        };
    }
    if (protocol === 'openai_legacy' || protocol === 'openai_responses') {
        const base = baseUrl ?? 'https://api.openai.com/v1';
        return {
            url: `${base.replace(/\/+$/, '')}/models`,
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        };
    }
    return null;
}
/**
 * 对单个候选 Key 发起一次最小化的只读请求（模型列表），验证其是否真正可用。
 * 不消耗生成 token，仅用于确认鉴权是否通过。
 *
 * 调用方需注意：这会发出真实网络请求，仅应在用户主动触发验证时调用
 * （如 `xiaok doctor --check-keys`），不应在普通命令路径中静默调用。
 */
export async function probeApiKey(protocol, baseUrl, apiKey) {
    const request = buildProbeRequest(protocol, baseUrl, apiKey);
    if (!request) {
        return { status: 'unknown_protocol', detail: `未知协议: ${protocol}` };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const resp = await fetch(request.url, {
            method: 'GET',
            headers: request.headers,
            signal: controller.signal,
        });
        if (resp.ok) {
            return { status: 'valid', httpStatus: resp.status };
        }
        if (resp.status === 401 || resp.status === 403) {
            return { status: 'invalid', httpStatus: resp.status, detail: '鉴权失败（401/403），Key 无效或已过期' };
        }
        return {
            status: 'network_error',
            httpStatus: resp.status,
            detail: `请求返回非预期状态码 ${resp.status}`,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'network_error', detail: message };
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * 依次验证多个候选 Key，返回第一个通过验证的结果（连同其索引），
 * 或在全部失败后返回每个候选的验证结果供诊断展示。
 */
export async function probeCandidates(protocol, baseUrl, candidates) {
    const results = [];
    for (const candidate of candidates) {
        const result = await probeApiKey(protocol, baseUrl, candidate.apiKey);
        results.push({ candidate, result });
    }
    return results;
}
