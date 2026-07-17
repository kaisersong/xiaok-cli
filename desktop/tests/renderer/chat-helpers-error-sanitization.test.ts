import { describe, expect, it, vi } from 'vitest'
import { sanitizeUserFacingErrorMessage } from '../../renderer/src/lib/error-display'

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
