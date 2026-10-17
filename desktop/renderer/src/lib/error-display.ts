// 待设计师确认：缺少模型 Key 的保守文案，设置入口暂以文字呈现。
const MODEL_KEY_MISSING_MESSAGE = '没有找到模型 API Key，任务没法开始。请到 设置 → 模型设置 里添加你的 API Key。'
const MODEL_AUTH_ERROR_MESSAGE = '模型服务认证失败：API Key 无效或已过期，请在设置中重新配置对应模型提供商的 API Key。'
const MODEL_SERVICE_ERROR_MESSAGE = '模型服务请求失败，请检查模型配置或稍后重试。'

interface UserFacingErrorOptions {
  modelKeyMissing?: string
  providerAuth?: string
  providerService?: string
  modelConnectionFailed?: string
  modelUsageLimitReached?: (resetAt?: string) => string
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error === null || typeof error === 'undefined') return ''
  return String(error)
}

export function isModelKeyMissingError(text: string): boolean {
  const keyOrProvider = '(?:api[\\s_-]*key|model\\s+provider)'
  return /\brequires\s+api[\s_-]*key\b/i.test(text)
    || /\bLLM\s+config\s+must\s+include\s+(?:a\s+)?["']provider["']/i.test(text)
    || new RegExp(`\\b(?:no|missing)\\s+(?:model\\s+)?${keyOrProvider}\\b`, 'i').test(text)
    || new RegExp(`\\b${keyOrProvider}\\s+(?:(?:is|was|has\\s+been)\\s+)?(?:missing|not\\s+(?:configured|set|provided|found))\\b`, 'i').test(text)
}

function isProviderAuthError(text: string): boolean {
  const lower = text.toLowerCase()
  const hasStatus = /\b(?:401|403)\b/.test(lower)
  const hasAuthSignal = /authentication_error|unauthorized|forbidden|api\s*key|api_key|credentials?|expired|invalid/.test(lower)
  if (hasStatus && hasAuthSignal) return true
  return (
    /authentication_error/.test(lower)
    || /(?:api\s*key|api_key)[\s\S]{0,80}(?:invalid|expired)/.test(lower)
    || /(?:invalid|expired)[\s\S]{0,80}(?:api\s*key|api_key)/.test(lower)
    || /credentials?[\s\S]{0,80}(?:invalid|expired|verify|try again)/.test(lower)
  )
}

function isProviderResponseDump(text: string): boolean {
  const lower = text.toLowerCase()
  const hasHttpStatus = /\b(?:400|401|403|404|408|409|422|429|500|502|503|504)\b/.test(lower)
  const hasStructuredBody = /[{[]\s*["']?(?:error|type|message|status|code)["']?\s*[:=]/i.test(text)
    || /["']?(?:error|type|message|status|code)["']?\s*[:=]\s*["'{([]/i.test(text)
  if (hasHttpStatus && hasStructuredBody) return true
  return /^Error:\s*\d{3}\s*[{[]/i.test(text) || /{"error"/i.test(text)
}

function isModelUsageLimitError(text: string): boolean {
  return /\b429\b/.test(text) && /usage\s+limit|quota|使用上限|限额|额度/i.test(text)
}

function extractResetAt(text: string): string | undefined {
  return text.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?/)?.[0]
}

export function sanitizeUserFacingErrorMessage(
  error: unknown,
  fallbackMessage = '请求失败',
  options?: UserFacingErrorOptions,
): string {
  const text = errorText(error).trim()
  if (!text) return fallbackMessage
  if (isModelKeyMissingError(text)) {
    console.error('[error-display] missing model configuration (raw):', text)
    return options?.modelKeyMissing ?? MODEL_KEY_MISSING_MESSAGE
  }
  if (isProviderAuthError(text)) return options?.providerAuth ?? MODEL_AUTH_ERROR_MESSAGE
  if (isModelUsageLimitError(text) && options?.modelUsageLimitReached) {
    return options.modelUsageLimitReached(extractResetAt(text))
  }
  if (options?.modelConnectionFailed && /^(?:Error:\s*)?(?:terminated|socket hang up|fetch failed|Premature close|ECONNRESET|ETIMEDOUT|EPIPE|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_SOCKET)$|OpenAI stream ended before finish_reason|model stream idle timeout|模型连接持续不可用/i.test(text)) {
    return options.modelConnectionFailed
  }
  if (isProviderResponseDump(text)) {
    console.error('[error-display] provider response dump (raw):', text)
    return options?.providerService ?? MODEL_SERVICE_ERROR_MESSAGE
  }
  return text.replace(/^Error:\s*/i, '').trim() || fallbackMessage
}
