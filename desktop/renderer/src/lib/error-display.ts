const MODEL_AUTH_ERROR_MESSAGE = '模型服务认证失败：API Key 无效或已过期，请在设置中重新配置对应模型提供商的 API Key。'
const MODEL_SERVICE_ERROR_MESSAGE = '模型服务请求失败，请检查模型配置或稍后重试。'

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error === null || typeof error === 'undefined') return ''
  return String(error)
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

export function sanitizeUserFacingErrorMessage(error: unknown, fallbackMessage = '请求失败'): string {
  const text = errorText(error).trim()
  if (!text) return fallbackMessage
  if (isProviderAuthError(text)) return MODEL_AUTH_ERROR_MESSAGE
  if (isProviderResponseDump(text)) {
    console.error('[error-display] provider response dump (raw):', text)
    return MODEL_SERVICE_ERROR_MESSAGE
  }
  return text.replace(/^Error:\s*/i, '').trim() || fallbackMessage
}
