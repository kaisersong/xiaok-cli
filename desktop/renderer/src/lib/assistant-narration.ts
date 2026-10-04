/** Display-only boundary between model rounds separated by tool execution.
 * Never use chunk boundaries: chunks may split a word or Markdown token. */
export function separateAssistantNarration(text: string): string {
  if (!text.trim() || text.endsWith('\n\n')) return text;
  return text + (text.endsWith('\n') ? '\n' : '\n\n');
}

/** Keep display result deduplication aligned with narration without rewriting
 * durable results or replacing a separately authored final summary. */
export function projectNarrationSummary<T extends { summary: string }>(result: T, formatted: string,
  events: ReadonlyArray<{ type: string; delta?: string }>): T {
  if (!formatted.trim()) return result;
  const raw = events.filter(event => event.type === 'assistant_delta').map(event => event.delta ?? '').join('');
  return result.summary.trim() === raw.trim() ? { ...result, summary: formatted.trim() } : result;
}
