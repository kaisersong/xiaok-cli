import { describe, expect, it } from 'vitest'
import { sanitizeUserFacingErrorMessage } from '../../renderer/src/lib/error-display'

const rawProviderAuthError = 'Error: 401 {"error":{"type":"authentication_error","message":"The API Key appears to be invalid or may have expired. Please verify your credentials and try again."},"type":"error"}'

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
})
