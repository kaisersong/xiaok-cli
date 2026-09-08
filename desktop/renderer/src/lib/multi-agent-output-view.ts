import type { DesktopAgentSnapshot, MultiAgentDurableEvent, MultiAgentMessage } from '../../../shared/multi-agent-types';

const MAX_PAGES = 10;
const PAGE_SIZE = 50;
const MAX_ENTRIES = 50;
const MAX_ENTRY_UNITS = 8192;
const MAX_TOTAL_UNITS = 65536;
type VisibleKind = 'output' | 'result' | 'message_sent' | 'artifact' | 'delivery';
export interface AgentOutputEntry {
  key: string; kind: VisibleKind | 'summary' | 'last_result'; event?: MultiAgentDurableEvent;
  text: string; partial: boolean;
}
export interface AgentOutputView { entries: AgentOutputEntry[]; partial: boolean }

/** Scalar-safe display prefix, never a replacement for the durable content. */
function prefix(text: string, max: number): string {
  let end = Math.min(text.length, max);
  if (end > 0 && end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
    && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
  return text.slice(0, end);
}
function sameTurn(a: MultiAgentDurableEvent, b: MultiAgentDurableEvent): boolean {
  return Boolean(a.turnId && a.turnId === b.turnId && a.agentId === b.agentId && a.groupId === b.groupId);
}
function sourceText(event: MultiAgentDurableEvent, userSender: string): string {
  if (event.kind === 'message_sent') {
    const message = event.payload.message as MultiAgentMessage | undefined;
    return message ? `${message.sender.kind === 'user' ? userSender : message.sender.agentId} → ${message.receiverId}\n${message.preview}` : '';
  }
  return typeof event.payload.text === 'string' ? event.payload.text : typeof event.payload.preview === 'string' ? event.payload.preview : '';
}
function entry(event: MultiAgentDurableEvent, userSender: string): AgentOutputEntry {
  const raw = sourceText(event, userSender), text = prefix(raw, MAX_ENTRY_UNITS);
  return { key: event.eventId, kind: event.kind as VisibleKind, event, text,
    partial: text.length !== raw.length || event.payload.truncated === true || (event.payload.message as MultiAgentMessage | undefined)?.truncated === true };
}
function budget(entries: AgentOutputEntry[]): AgentOutputEntry[] {
  let remaining = MAX_TOTAL_UNITS;
  const result = entries.slice();
  for (let index = result.length - 1; index >= 0; index--) {
    const item = result[index], text = prefix(item.text, remaining);
    remaining -= text.length;
    if (text.length !== item.text.length) result[index] = { ...item, text, partial: true };
  }
  return result;
}

/** A bounded presentation over the connection's existing cache; no I/O or new history owner. */
export function buildAgentOutputView(input: {
  groupId: string | null; agent: DesktopAgentSnapshot;
  details: (agentId: string, beforeSeq?: number) => MultiAgentDurableEvent[]; userSender: string;
}): AgentOutputView {
  const events: MultiAgentDurableEvent[] = [];
  let beforeSeq = Infinity, limited = false;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = input.details(input.agent.id, beforeSeq);
    if (!page.length) break;
    if (page.length > PAGE_SIZE || page.some(event => event.seq >= beforeSeq) || page[0].seq >= beforeSeq) { limited = true; break; }
    events.unshift(...page);
    beforeSeq = page[0].seq;
    if (page.length < PAGE_SIZE) break;
    if (pageIndex === MAX_PAGES - 1) limited = true;
  }
  const first = events[0], initial = first?.payload.agent as DesktopAgentSnapshot | undefined;
  let partial = limited || Boolean(first && first.seq !== 1 && !(first.kind === 'status' && initial?.id === input.agent.id
    && initial.turn === 1 && initial.status === 'pending'));
  const visible: AgentOutputEntry[] = [];
  let active: AgentOutputEntry | undefined;
  let truncatedTail: MultiAgentDurableEvent | undefined;
  for (const event of events) {
    if (event.groupId !== input.groupId || event.agentId !== input.agent.id) { active = undefined; truncatedTail = undefined; partial = true; continue; }
    if (event.kind === 'usage') {
      if (!active?.event || !sameTurn(active.event, event)) active = undefined;
      if (truncatedTail && !sameTurn(truncatedTail, event)) truncatedTail = undefined;
      continue;
    }
    if (event.kind === 'output') {
      const next = entry(event, input.userSender);
      if (active?.event && sameTurn(active.event, event) && event.payload.truncated !== true) {
        const text = prefix(typeof event.payload.text === 'string' ? event.payload.text : next.text, MAX_ENTRY_UNITS - active.text.length);
        active.text += text;
        active.partial ||= next.partial || text.length !== next.text.length;
      } else {
        next.partial ||= Boolean(truncatedTail && sameTurn(truncatedTail, event));
        visible.push(next); active = event.turnId && event.payload.truncated !== true ? next : undefined;
      }
      if (event.payload.truncated === true) truncatedTail = event;
      continue;
    }
    if (event.kind === 'result' && active?.event && sameTurn(active.event, event) && !active.partial
      && event.payload.truncated === false && event.payload.preview === active.text) visible.pop();
    active = undefined; truncatedTail = undefined;
    if (event.kind === 'result' || event.kind === 'message_sent' || event.kind === 'artifact' || event.kind === 'delivery') visible.push(entry(event, input.userSender));
  }
  partial ||= visible.length > MAX_ENTRIES;
  const history = visible.slice(-MAX_ENTRIES);
  let entries = budget(history);
  const fallbacks = new Map<'summary' | 'last_result', AgentOutputEntry>();
  // There are only two snapshot fallback paths. Recheck after applying the
  // shared budget: a now-clipped history item must not suppress its fallback.
  for (let pass = 0; pass < 3; pass++) {
    const covered = (text: string) => Boolean(input.agent.turnId && entries.some(item => !item.partial && item.event?.turnId === input.agent.turnId
      && (item.kind === 'output' || item.kind === 'result') && item.text === text));
    const addFallback = (kind: 'summary' | 'last_result', raw?: string) => {
      if (!raw || covered(raw) || fallbacks.has(kind)) return;
      const text = prefix(raw, MAX_ENTRY_UNITS);
      fallbacks.set(kind, { key: `snapshot-${kind}`, kind, text, partial: text.length !== raw.length });
    };
    if (!input.agent.executionActive && input.agent.resultSummary !== input.agent.lastResult) addFallback('summary', input.agent.resultSummary);
    addFallback('last_result', input.agent.lastResult);
    entries = budget([...(fallbacks.has('summary') ? [fallbacks.get('summary')!] : []), ...history,
      ...(fallbacks.has('last_result') ? [fallbacks.get('last_result')!] : [])]);
  }
  return { entries, partial };
}
