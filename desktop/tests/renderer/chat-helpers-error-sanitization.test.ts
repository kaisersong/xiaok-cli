import { describe, expect, it, vi } from 'vitest'
import { isModelKeyMissingError, sanitizeUserFacingErrorMessage } from '../../renderer/src/lib/error-display'

import { zh } from '../../renderer/src/locales/zh'
import { en } from '../../renderer/src/locales/en'

const rawProviderAuthError = 'Error: 401 {"error":{"type":"authentication_error","message":"The API Key appears to be invalid or may have expired. Please verify your credentials and try again."},"type":"error"}'

const zhUsageLimit = (resetAt?: string) => resetAt
  ? `当前模型使用额度已达上限，将于 ${resetAt} 重置。请在额度恢复后重试，或切换其他可用模型。`
  : '当前模型使用额度已达上限。请稍后重试，或切换其他可用模型。'

const enUsageLimit = (resetAt?: string) => resetAt
  ? `The current model usage limit has been reached. It resets at ${resetAt}. Try again after the reset or switch to another available model.`
  : 'The current model usage limit has been reached. Try again later or switch to another available model.'

function expectNoRawProviderLeak(message: string): void {
  expect(message).not.toContain('authentication_error')
  expect(message).not.toContain('The API Key appears')
  expect(message).not.toContain('{"error"')
  expect(message).not.toContain('Error: 401')
}

describe('chat error display sanitization', () => {
  it('maps provider authentication exceptions to an actionable display message', () => {
    const message = sanitizeUserFacingErrorMessage(new Error(rawProviderAuthError))

    expect(message).toContain('API Key')
    expect(message).toContain('设置')
    expectNoRawProviderLeak(message)
  })

  it('sanitizes run.failed provider payload messages', () => {
    const message = sanitizeUserFacingErrorMessage(rawProviderAuthError, '运行失败')

    expect(message).toContain('API Key')
    expect(message).toContain('设置')
    expectNoRawProviderLeak(message)
  })

  it('maps raw provider response bodies to a generic model-service message', () => {
    const message = sanitizeUserFacingErrorMessage('Error: 500 {"error":{"type":"server_error","message":"upstream stack trace"}}')

    expect(message).toContain('模型服务请求失败')
    expect(message).not.toContain('server_error')
    expect(message).not.toContain('upstream stack trace')
    expect(message).not.toContain('{"error"')
  })

  it('maps a usage-limit 429 to the localized quota message with reset time', () => {
    const resetAt = '2026-07-15 14:18:50'
    const message = sanitizeUserFacingErrorMessage(
      `429 您已达到每周/每月使用上限，您的限额将在 ${resetAt} 重置。`,
      '任务创建失败',
      { modelUsageLimitReached: zhUsageLimit },
    )

    expect(message).toContain('额度已达上限')
    expect(message).toContain(resetAt)
    expect(message).toContain('切换')
    expect(message).not.toContain('429')
  })

  it('maps structured usage-limit payloads before generic provider dumps', () => {
    const resetAt = '2026-07-15 14:18:50'
    const message = sanitizeUserFacingErrorMessage(
      `Error: 429 {"error":{"message":"You have reached your monthly usage limit. Your limit resets at ${resetAt}."}}`,
      'Task creation failed',
      { modelUsageLimitReached: enUsageLimit },
    )

    expect(message).toContain('usage limit')
    expect(message).toContain(resetAt)
    expect(message).toContain('switch')
    expect(message).not.toContain('{"error"')
    expect(message).not.toContain('Error: 429')
  })

  it('maps usage-limit 429 responses without reset time through the localized fallback', () => {
    const modelUsageLimitReached = vi.fn(enUsageLimit)
    const message = sanitizeUserFacingErrorMessage(
      '429 You have reached your monthly usage limit.',
      'Task creation failed',
      { modelUsageLimitReached },
    )

    expect(modelUsageLimitReached).toHaveBeenCalledOnce()
    expect(modelUsageLimitReached).toHaveBeenCalledWith(undefined)
    expect(message).toBe(enUsageLimit())
  })

  it('does not classify usage-limit wording without a 429 as exhausted quota', () => {
    const modelUsageLimitReached = vi.fn(enUsageLimit)
    const rawMessage = 'You have reached your monthly usage limit.'
    const message = sanitizeUserFacingErrorMessage(
      rawMessage,
      'Task creation failed',
      { modelUsageLimitReached },
    )

    expect(modelUsageLimitReached).not.toHaveBeenCalled()
    expect(message).toBe(rawMessage)
  })

  it('does not misclassify a transient rate limit as exhausted usage quota', () => {
    const message = sanitizeUserFacingErrorMessage(
      '429 rate limit exceeded',
      'Task creation failed',
      { modelUsageLimitReached: enUsageLimit },
    )

    expect(message).not.toContain('usage limit has been reached')
  })

  it('uses the caller-provided provider authentication message', () => {
    const message = sanitizeUserFacingErrorMessage(
      rawProviderAuthError,
      'Task creation failed',
      { providerAuth: 'Localized provider authentication failure.' },
    )

    expect(message).toBe('Localized provider authentication failure.')
  })

  it('uses the caller-provided provider service message', () => {
    const message = sanitizeUserFacingErrorMessage(
      'Error: 500 {"error":{"type":"server_error","message":"upstream stack trace"}}',
      'Task creation failed',
      { providerService: 'Localized provider service failure.' },
    )

    expect(message).toBe('Localized provider service failure.')
  })
})

describe('connection failures have an actionable localized explanation', () => {
  it.each(['terminated', 'OpenAI stream ended before finish_reason', 'Error: socket hang up', 'UND_ERR_SOCKET', '模型连接持续不可用，自动恢复窗口已耗尽；已完成的工作保留，可稍后继续。'])('maps %s without blaming credentials', raw => {
    expect(sanitizeUserFacingErrorMessage(raw, 'fallback', { modelConnectionFailed: 'Connection interrupted; completed work was saved. Continue or switch model.' })).toBe('Connection interrupted; completed work was saved. Continue or switch model.');
  });
  it('keeps authentication failures distinct from network wording', () => {
    expect(sanitizeUserFacingErrorMessage('401 authentication_error: terminated', 'fallback', { providerAuth: 'Fix API key', modelConnectionFailed: 'Retry network' })).toBe('Fix API key');
  });
});


describe('missing model configuration', () => {
  it.each([
    'Error: OpenAI provider requires apiKey',
    'Error: Anthropic provider requires apiKey',
    'Error: LLM config must include a "provider" field ...',
    'No API key configured',
    'Missing model API key',
    'No model provider configured',
    'Model provider is missing',
    'API_KEY is not configured',
    'OPENAI PROVIDER REQUIRES APIKEY',
    '401: OpenAI provider requires apiKey',
  ])('replaces %s with the explanation, action and settings entry', raw => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(isModelKeyMissingError(raw)).toBe(true)
      const message = sanitizeUserFacingErrorMessage(raw, 'fallback', { providerAuth: 'Auth failure' })
      expect(message).toBe(zh.chatShell.modelKeyMissing)
      expect(message).toContain('没有找到模型 API Key，任务没法开始。')
      expect(message).toContain('添加你的 API Key')
      expect(message).toContain(`设置 → ${zh.desktopSettings.navModel}`)
      expect(message).not.toMatch(/apiKey|provider|Error:/)
      expect(log).toHaveBeenCalledWith('[error-display] missing model configuration (raw):', raw)
    } finally {
      log.mockRestore()
    }
  })

  it('uses the English locale and its actual settings navigation label', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(sanitizeUserFacingErrorMessage(new Error('Anthropic provider requires apiKey'), 'fallback', {
        modelKeyMissing: en.chatShell.modelKeyMissing,
      })).toBe(`No model API key was found, so the task can't start. Open Settings → ${en.desktopSettings.navModel} and add your API key.`)
    } finally {
      log.mockRestore()
    }
  })

  it.each(['401 Unauthorized: API key rejected', 'Invalid API key'])('preserves authentication handling for %s', raw => {
    expect(isModelKeyMissingError(raw)).toBe(false)
    expect(sanitizeUserFacingErrorMessage(raw, 'fallback', {
      providerAuth: 'Auth failure', modelKeyMissing: 'Missing key',
    })).toBe('Auth failure')
  })

  it.each(['Error: File not found', 'No model output found', 'Missing API response', 'Model provider returned no results'])('preserves ordinary errors: %s', raw => {
    expect(isModelKeyMissingError(raw)).toBe(false)
    expect(sanitizeUserFacingErrorMessage(raw)).toBe(raw.replace(/^Error: /, ''))
  })
})
