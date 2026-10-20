/** Public display projection shared by the renderer and continuity source adapter. */
export function separateAssistantNarration(text: string): string {
  if (!text.trim() || text.endsWith('\n\n')) return text;
  return text + (text.endsWith('\n') ? '\n' : '\n\n');
}
export function projectNarrationSummary<T extends { summary: string }>(result: T, formatted: string,
  events: ReadonlyArray<{ type: string; delta?: string }>): T {
  if (!formatted.trim()) return result;
  const raw = events.filter(event => event.type === 'assistant_delta').map(event => event.delta ?? '').join('');
  return result.summary.trim() === raw.trim() ? { ...result, summary: formatted.trim() } : result;
}
export function normalizePublicComparableText(text: string): string { return text.replace(/\r\n?/g, '\n').trim(); }
