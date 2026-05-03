import { describe, expect, it } from 'vitest'
import { measureTextareaHeight } from './measureTextareaHeight'

describe('measureTextareaHeight', () => {
  it('至少返回最小行高', () => {
    expect(measureTextareaHeight({
      value: '',
      width: 200,
      font: '16px Inter',
      lineHeight: 24,
      minRows: 3,
    })).toBeGreaterThanOrEqual(72)
  })

  it('多行文本高度高于单行', () => {
    const single = measureTextareaHeight({
      value: 'hello',
      width: 200,
      font: '16px Inter',
      lineHeight: 24,
    })
    const multi = measureTextareaHeight({
      value: 'hello\nworld\nagain',
      width: 200,
      font: '16px Inter',
      lineHeight: 24,
    })
    expect(multi).toBeGreaterThan(single)
  })
})
