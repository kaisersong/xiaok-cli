import { createHash, randomUUID } from 'node:crypto';
import { compactOpenAIResponsesContext, createStatelessOpenAIResponse, } from '../adapters/openai-responses-native.js';
const INITIAL_INPUT = [
    {
        role: 'system',
        content: [
            {
                type: 'input_text',
                text: 'This isolated smoke uses synthetic, declassified data only.',
            },
        ],
    },
    {
        role: 'user',
        content: [
            {
                type: 'input_text',
                text: 'Call synthetic_lookup for the fixed synthetic record.',
            },
        ],
    },
];
const SYNTHETIC_TOOLS = [
    {
        type: 'function',
        name: 'synthetic_lookup',
        description: 'Returns a fixed synthetic value without external execution.',
        parameters: {
            type: 'object',
            properties: {
                record: { type: 'string' },
            },
            required: ['record'],
            additionalProperties: false,
        },
        strict: true,
    },
];
const NEXT_USER_ITEM = {
    role: 'user',
    content: [
        {
            type: 'input_text',
            text: 'Confirm the synthetic sequence is complete in one sentence.',
        },
    ],
};
const DEFAULT_FIXED_TOOL_OUTPUTS = {
    synthetic_lookup: '{"status":"ok","value":"synthetic-fixed-value"}',
};
const SMOKE_SUITE_VERSION = 'openai-native-compaction-smoke-v1';
const SHA256_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
export function createDefaultOpenAINativeCompactionSmokeFixture() {
    return {
        initialInput: INITIAL_INPUT,
        tools: SYNTHETIC_TOOLS,
        fixedToolOutputs: DEFAULT_FIXED_TOOL_OUTPUTS,
        nextUserItem: NEXT_USER_ITEM,
    };
}
export async function runOpenAINativeCompactionSmoke(params) {
    const startedAt = Date.now();
    const generatedAt = new Date(startedAt).toISOString();
    const modelFingerprint = fingerprint(params.model);
    const originFingerprint = fingerprint(params.baseUrl);
    const accountProjectFingerprint = params.accountProjectFingerprint?.trim();
    if (!params.apiKey?.trim()
        || !accountProjectFingerprint
        || !SHA256_FINGERPRINT.test(accountProjectFingerprint)) {
        return {
            schemaVersion: 1,
            suiteVersion: SMOKE_SUITE_VERSION,
            generatedAt,
            status: 'live_capability_smoke_missing',
            modelFingerprint,
            originFingerprint,
            accountProjectFingerprint: SHA256_FINGERPRINT.test(accountProjectFingerprint ?? '')
                ? accountProjectFingerprint
                : undefined,
            requests: [],
            totalUsage: emptyTotalUsage(),
            elapsedMs: 0,
        };
    }
    const requests = [];
    let failurePhase = 'initial';
    try {
        const initialClientRequestId = createClientRequestId('initial');
        const initial = await createStatelessOpenAIResponse({
            ...requestParams(params, initialClientRequestId),
            input: params.fixture.initialInput,
            tools: params.fixture.tools,
        });
        requests.push(toEvidence('initial', initialClientRequestId, initial));
        const pairedToolOutputs = createPairedSyntheticToolOutputs(initial.output, params.fixture.fixedToolOutputs);
        const compactInput = [
            ...params.fixture.initialInput,
            ...initial.output,
            ...pairedToolOutputs,
        ];
        failurePhase = 'compact';
        const compactClientRequestId = createClientRequestId('compact');
        const compact = await compactOpenAIResponsesContext({
            ...requestParams(params, compactClientRequestId),
            input: compactInput,
        });
        requests.push(toEvidence('compact', compactClientRequestId, compact));
        failurePhase = 'continuation';
        const continuationClientRequestId = createClientRequestId('continuation');
        const continuation = await createStatelessOpenAIResponse({
            ...requestParams(params, continuationClientRequestId),
            input: [
                ...compact.output,
                params.fixture.nextUserItem,
            ],
            tools: params.fixture.tools,
        });
        requests.push(toEvidence('continuation', continuationClientRequestId, continuation));
        return {
            schemaVersion: 1,
            suiteVersion: SMOKE_SUITE_VERSION,
            generatedAt,
            status: 'passed',
            modelFingerprint,
            originFingerprint,
            accountProjectFingerprint,
            requests,
            totalUsage: sumUsage(requests),
            elapsedMs: Math.max(0, Date.now() - startedAt),
        };
    }
    catch (error) {
        return {
            schemaVersion: 1,
            suiteVersion: SMOKE_SUITE_VERSION,
            generatedAt,
            status: 'failed',
            modelFingerprint,
            originFingerprint,
            accountProjectFingerprint,
            requests,
            totalUsage: sumUsage(requests),
            elapsedMs: Math.max(0, Date.now() - startedAt),
            failureClass: classifyFailure(error),
            failurePhase,
        };
    }
}
function requestParams(params, requestId) {
    return {
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        model: params.model,
        organization: params.organization,
        project: params.project,
        requestId,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
    };
}
function createPairedSyntheticToolOutputs(output, fixedToolOutputs) {
    const paired = [];
    for (const item of output) {
        if (item.type !== 'function_call')
            continue;
        if (typeof item.call_id !== 'string' || item.call_id.length === 0) {
            throw new Error('synthetic_fixture_invalid_function_call');
        }
        const fixedOutput = typeof item.name === 'string' && Object.hasOwn(fixedToolOutputs, item.name)
            ? fixedToolOutputs[item.name]
            : undefined;
        if (typeof fixedOutput !== 'string') {
            throw new Error('synthetic_fixture_unexpected_tool');
        }
        paired.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output: fixedOutput,
        });
    }
    if (paired.length === 0) {
        throw new Error('synthetic_fixture_missing_tool_call');
    }
    return paired;
}
function createClientRequestId(phase) {
    return `xiaok-native-compaction-smoke-${phase}-${randomUUID()}`;
}
function toEvidence(phase, clientRequestId, result) {
    return {
        phase,
        clientRequestId,
        responseId: result.responseId,
        createdAt: result.createdAt,
        usage: result.usage,
        elapsedMs: result.elapsedMs,
    };
}
function sumUsage(requests) {
    return requests.reduce((sum, request) => ({
        inputTokens: sum.inputTokens + request.usage.inputTokens,
        outputTokens: sum.outputTokens + request.usage.outputTokens,
        totalTokens: sum.totalTokens + request.usage.totalTokens,
    }), emptyTotalUsage());
}
function emptyTotalUsage() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
}
function fingerprint(value) {
    const digest = createHash('sha256').update(value).digest('hex');
    return `sha256:${digest}`;
}
function classifyFailure(error) {
    if (error instanceof Error) {
        const httpStatus = /HTTP (\d{3})/.exec(error.message)?.[1];
        if (httpStatus)
            return `http_${httpStatus}`;
        if (error.name === 'TimeoutError')
            return 'timeout';
        if (error.name === 'AbortError')
            return 'aborted';
        if (/synthetic_fixture_/.test(error.message))
            return error.message;
        if (/baseUrl|response|input|model|apiKey|function_call|timeoutMs/i.test(error.message)) {
            return 'contract_validation';
        }
    }
    return 'request_failed';
}
