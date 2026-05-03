import { layout, prepare } from '@chenglou/pretext'

type Input = {
  value: string
  width: number
  font: string
  lineHeight: number
  minRows?: number
}

export function measureTextareaHeight({
  value,
  width,
  font,
  lineHeight,
  minRows = 1,
}: Input): number {
  const safeLineHeight = Math.max(lineHeight, 1)
  const safeWidth = Math.max(width, 1)
  const safeMinRows = Math.max(minRows, 1)
  const text = value.length > 0 ? value : ' '
  const prepared = prepare(text, font, { whiteSpace: 'pre-wrap' })
  const { height } = layout(prepared, safeWidth, safeLineHeight)
  return Math.max(height, safeLineHeight * safeMinRows)
}
