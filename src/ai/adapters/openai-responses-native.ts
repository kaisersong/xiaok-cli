const PUBLIC_OPENAI_V1_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type OpenAIResponseInputItem = Readonly<Record<string, unknown>>;
export type OpenAIResponseTool = Readonly<Record<string, unknown>>;

export interface OpenAINativeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
}

export interface OpenAINativeResponseResult {
  responseId: string;
  createdAt: number;
  output: ReadonlyArray<Record<string, unknown>>;
  usage: OpenAINativeUsage;
  elapsedMs: number;
}

interface OpenAINativeRequestParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: ReadonlyArray<OpenAIResponseInputItem>;
  organization?: string;
  project?: string;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CreateStatelessOpenAIResponseParams extends OpenAINativeRequestParams {
  tools?: ReadonlyArray<OpenAIResponseTool>;
}

export type CompactOpenAIResponsesContextParams = OpenAINativeRequestParams;

type ExpectedResponseObject = 'response' | 'response.compaction';

export async function createStatelessOpenAIResponse(
  params: CreateStatelessOpenAIResponseParams,
): Promise<OpenAINativeResponseResult> {
  const validated = validateRequestParams(params);
  const body: Record<string, unknown> = {
    model: validated.model,
    input: params.input,
  };
  if (params.tools !== undefined) {
    body.tools = params.tools;
  }
  body.store = false;

  return postOpenAIResponse({
    ...validated,
    endpoint: `${validated.baseUrl}/responses`,
    body,
    expectedObject: 'response',
  });
}

export async function compactOpenAIResponsesContext(
  params: CompactOpenAIResponsesContextParams,
): Promise<OpenAINativeResponseResult> {
  const validated = validateRequestParams(params);
  validateToolHistory(params.input);

  return postOpenAIResponse({
    ...validated,
    endpoint: `${validated.baseUrl}/responses/compact`,
    body: {
      model: validated.model,
      input: params.input,
    },
    expectedObject: 'response.compaction',
  });
}

interface ValidatedRequest {
  apiKey: string;
  baseUrl: typeof PUBLIC_OPENAI_V1_BASE_URL;
  model: string;
  organization?: string;
  project?: string;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

function validateRequestParams(params: OpenAINativeRequestParams): ValidatedRequest {
  const apiKey = requireNonEmptyString(params.apiKey, 'apiKey');
  const model = requireNonEmptyString(params.model, 'model');
  if (!Array.isArray(params.input) || params.input.length === 0) {
    throw new Error('OpenAI native input must be a non-empty array');
  }
  for (const item of params.input) {
    if (!isRecord(item)) {
      throw new Error('OpenAI native input items must be objects');
    }
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('OpenAI native timeoutMs must be a positive number');
  }

  return {
    apiKey,
    baseUrl: validatePublicOpenAIBaseUrl(params.baseUrl),
    model,
    organization: params.organization,
    project: params.project,
    requestId: params.requestId,
    signal: params.signal,
    timeoutMs,
  };
}

function validatePublicOpenAIBaseUrl(baseUrl: string): typeof PUBLIC_OPENAI_V1_BASE_URL {
  if (baseUrl !== PUBLIC_OPENAI_V1_BASE_URL && baseUrl !== `${PUBLIC_OPENAI_V1_BASE_URL}/`) {
    throw new Error(`OpenAI native baseUrl must be exactly ${PUBLIC_OPENAI_V1_BASE_URL}`);
  }
  return PUBLIC_OPENAI_V1_BASE_URL;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OpenAI native ${field} must be a non-empty string`);
  }
  return value.trim();
}

interface PostOpenAIResponseParams extends ValidatedRequest {
  endpoint: string;
  body: Record<string, unknown>;
  expectedObject: ExpectedResponseObject;
}

async function postOpenAIResponse(
  params: PostOpenAIResponseParams,
): Promise<OpenAINativeResponseResult> {
  if (params.signal?.aborted) {
    throw abortReason(params.signal);
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(abortReason(params.signal));
  params.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('OpenAI native request timed out', 'TimeoutError'));
  }, params.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: buildHeaders(params),
      body: JSON.stringify(params.body),
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await readCappedResponseText(response);
    if (!response.ok) {
      throw new Error(`OpenAI native request failed with HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('OpenAI native response was not valid JSON');
    }

    const validated = validateResponsePayload(payload, params.expectedObject);
    return {
      ...validated,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function buildHeaders(params: ValidatedRequest): Headers {
  const headers = new Headers();
  if (params.organization !== undefined) {
    headers.set('OpenAI-Organization', params.organization);
  }
  if (params.project !== undefined) {
    headers.set('OpenAI-Project', params.project);
  }
  if (params.requestId !== undefined) {
    headers.set('X-Client-Request-Id', params.requestId);
  }
  headers.set('Authorization', `Bearer ${params.apiKey}`);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('OpenAI native request aborted', 'AbortError');
}

async function readCappedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) {
      throw new Error('OpenAI native response exceeded the 32 MiB limit');
    }
  }

  if (!response.body) {
    throw new Error('OpenAI native response body was unavailable');
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('OpenAI native response exceeded the 32 MiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateResponsePayload(
  payload: unknown,
  expectedObject: ExpectedResponseObject,
): Omit<OpenAINativeResponseResult, 'elapsedMs'> {
  if (!isRecord(payload) || payload.object !== expectedObject) {
    throw new Error(`OpenAI native response object must be ${expectedObject}`);
  }
  const responseId = requireNonEmptyString(payload.id, 'response id');
  const createdAt = requireNonNegativeInteger(payload.created_at, 'created_at');
  if (!Array.isArray(payload.output)) {
    throw new Error('OpenAI native response output must be an array');
  }
  if (expectedObject === 'response' && payload.output.length === 0) {
    throw new Error('OpenAI native response output must be non-empty');
  }
  for (const item of payload.output) {
    if (!isRecord(item) || typeof item.type !== 'string' || item.type.length === 0) {
      throw new Error('OpenAI native response output items must have a string type');
    }
  }
  const output = payload.output as Array<Record<string, unknown>>;
  if (expectedObject === 'response.compaction') {
    const hasCanonicalCompaction = output.some((item) => (
      item.type === 'compaction'
      && typeof item.encrypted_content === 'string'
      && item.encrypted_content.length > 0
    ));
    if (!hasCanonicalCompaction) {
      throw new Error('OpenAI compact response must contain canonical compaction output');
    }
  }

  return {
    responseId,
    createdAt,
    output,
    usage: validateUsage(payload.usage),
  };
}

function validateUsage(value: unknown): OpenAINativeUsage {
  if (!isRecord(value)) {
    throw new Error('OpenAI native response usage must be an object');
  }
  const inputTokens = requireNonNegativeInteger(value.input_tokens, 'usage.input_tokens');
  const outputTokens = requireNonNegativeInteger(value.output_tokens, 'usage.output_tokens');
  const totalTokens = requireNonNegativeInteger(value.total_tokens, 'usage.total_tokens');
  let cachedInputTokens = 0;
  if (value.input_tokens_details !== undefined) {
    if (!isRecord(value.input_tokens_details)) {
      throw new Error('OpenAI native usage.input_tokens_details must be an object');
    }
    if (value.input_tokens_details.cached_tokens !== undefined) {
      cachedInputTokens = requireNonNegativeInteger(
        value.input_tokens_details.cached_tokens,
        'usage.input_tokens_details.cached_tokens',
      );
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
  };
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`OpenAI native ${field} must be a non-negative integer`);
  }
  return value as number;
}

function validateToolHistory(input: ReadonlyArray<OpenAIResponseInputItem>): void {
  let lastCanonicalBoundary = -1;
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index]!;
    if (item.type !== 'compaction') continue;
    if (
      typeof item.encrypted_content !== 'string'
      || item.encrypted_content.length === 0
    ) {
      throw new Error('Canonical compaction input must contain encrypted_content');
    }
    lastCanonicalBoundary = index;
  }

  const calls = new Set<string>();
  const outputs = new Set<string>();
  for (const item of input.slice(lastCanonicalBoundary + 1)) {
    if (item.type === 'function_call') {
      const callId = requireExactNonEmptyString(item.call_id, 'function_call.call_id');
      requireNonEmptyString(item.name, 'function_call.name');
      if (typeof item.arguments !== 'string') {
        throw new Error(`function_call arguments must be a string for call_id: ${callId}`);
      }
      if (calls.has(callId)) {
        throw new Error(`Duplicate function_call call_id: ${callId}`);
      }
      calls.add(callId);
    } else if (item.type === 'function_call_output') {
      const callId = requireExactNonEmptyString(item.call_id, 'function_call_output.call_id');
      validateFunctionCallOutput(item.output, callId);
      if (!calls.has(callId)) {
        throw new Error(`Orphan function_call_output call_id: ${callId}`);
      }
      if (outputs.has(callId)) {
        throw new Error(`Duplicate function_call_output call_id: ${callId}`);
      }
      outputs.add(callId);
    }
  }

  for (const callId of calls) {
    if (!outputs.has(callId)) {
      throw new Error(`Missing function_call_output for call_id: ${callId}`);
    }
  }
}

function requireExactNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OpenAI native ${field} must be a non-empty string`);
  }
  return value;
}

function validateFunctionCallOutput(value: unknown, callId: string): void {
  if (typeof value === 'string') return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `function_call_output output must be a string or non-empty content array for call_id: ${callId}`,
    );
  }

  for (const content of value) {
    if (!isRecord(content)) {
      throw new Error(`Invalid function_call_output content for call_id: ${callId}`);
    }
    if (content.type === 'input_text') {
      if (typeof content.text !== 'string') {
        throw new Error(`Invalid function_call_output input_text for call_id: ${callId}`);
      }
      continue;
    }
    if (content.type === 'input_image') {
      if (
        !hasNonEmptyString(content.image_url)
        && !hasNonEmptyString(content.file_id)
      ) {
        throw new Error(`Invalid function_call_output input_image for call_id: ${callId}`);
      }
      continue;
    }
    if (content.type === 'input_file') {
      if (
        !hasNonEmptyString(content.file_data)
        && !hasNonEmptyString(content.file_id)
        && !hasNonEmptyString(content.file_url)
      ) {
        throw new Error(`Invalid function_call_output input_file for call_id: ${callId}`);
      }
      continue;
    }
    throw new Error(`Unsupported function_call_output content type for call_id: ${callId}`);
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
