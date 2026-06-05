import mermaid from 'mermaid'

let mermaidInitialized = false

export function createMermaidConfig() {
  return {
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#f7f5ef',
      primaryTextColor: '#1f2933',
      primaryBorderColor: '#d9d4c9',
      lineColor: '#7b756a',
      secondaryColor: '#f3f0e8',
      tertiaryColor: '#fbfaf7',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    flowchart: { htmlLabels: false, curve: 'basis' },
    securityLevel: 'strict',
  } as const
}

export function ensureMermaidInit() {
  if (mermaidInitialized) return
  mermaid.initialize(createMermaidConfig())
  mermaidInitialized = true
}

export function shouldFallbackToMermaidSource(svg: string, source: string): boolean {
  if (!source.trim()) return true
  if (!svg || !svg.includes('<svg')) return true
  if (!/<(text|path|rect|line|circle|ellipse|polygon|polyline|g)\b/i.test(svg)) return true

  const readableText = svg
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
  return readableText.length === 0
}
