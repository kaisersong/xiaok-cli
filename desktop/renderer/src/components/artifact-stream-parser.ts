export function extractPartialArtifactFields(buffer: string): {
  title?: string
  filename?: string
  display?: string
  content?: string
  loadingMessages?: string[]
} {
  return {
    title: extractJSONStringField(buffer, 'title'),
    filename: extractJSONStringField(buffer, 'filename'),
    display: extractJSONStringField(buffer, 'display'),
    content: extractJSONStringField(buffer, 'content') ?? extractJSONStringField(buffer, 'widget_code'),
    loadingMessages: extractPartialStringArrayField(buffer, 'loading_messages'),
  }
}

export function extractPartialWidgetFields(buffer: string): {
  title?: string
  widgetCode?: string
  loadingMessages?: string[]
} {
  return {
    title: extractJSONStringField(buffer, 'title'),
    widgetCode: extractJSONStringField(buffer, 'widget_code'),
    loadingMessages: extractPartialStringArrayField(buffer, 'loading_messages'),
  }
}

function extractJSONStringField(buffer: string, field: string): string | undefined {
  const start = buffer.search(new RegExp(`"${field}"\\s*:\\s*"`))
  if (start < 0) return undefined
  const keyToken = `"${field}"`
  const valueStart = buffer.indexOf('"', start + keyToken.length)
  if (valueStart < 0) return undefined
  return readJSONString(buffer, valueStart + 1)
}

function readJSONString(source: string, start: number): string {
  let result = ''
  let index = start

  while (index < source.length) {
    const char = source[index]
    if (char === '"') return result
    if (char !== '\\') {
      result += char
      index += 1
      continue
    }

    const next = source[index + 1]
    if (next == null) return result
    if (next === 'u') {
      const hex = source.slice(index + 2, index + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 6
        continue
      }
      return result
    }

    result += decodeEscapedChar(next)
    index += 2
  }

  return result
}

/** Closed quoted string only; used for streaming JSON arrays. */
function readCompleteJSONString(source: string, start: number): { value: string; end: number } | null {
  let result = ''
  let index = start

  while (index < source.length) {
    const char = source[index]
    if (char === '"') return { value: result, end: index + 1 }
    if (char !== '\\') {
      result += char
      index += 1
      continue
    }

    const next = source[index + 1]
    if (next == null) return null
    if (next === 'u') {
      const hex = source.slice(index + 2, index + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 6
        continue
      }
      return null
    }

    result += decodeEscapedChar(next)
    index += 2
  }

  return null
}

function extractPartialStringArrayField(buffer: string, field: string): string[] | undefined {
  const keyToken = `"${field}"`
  const keyIdx = buffer.indexOf(keyToken)
  if (keyIdx < 0) return undefined
  let i = keyIdx + keyToken.length
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++
  if (i >= buffer.length || buffer[i] !== ':') return undefined
  i++
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++
  if (i >= buffer.length || buffer[i] !== '[') return undefined
  i++

  const out: string[] = []
  while (i < buffer.length) {
    while (i < buffer.length && /\s/.test(buffer[i]!)) i++
    if (i < buffer.length && buffer[i] === ']') return out
    if (i < buffer.length && buffer[i] === ',') {
      i++
      continue
    }
    if (i < buffer.length && buffer[i] === '"') {
      const parsed = readCompleteJSONString(buffer, i + 1)
      if (!parsed) return out.length > 0 ? out : undefined
      out.push(parsed.value)
      i = parsed.end
      continue
    }
    return out.length > 0 ? out : undefined
  }
  return out.length > 0 ? out : undefined
}

function decodeEscapedChar(char: string): string {
  switch (char) {
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case '"':
      return '"'
    case '\\':
      return '\\'
    case '/':
      return '/'
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    default:
      return char
  }
}
