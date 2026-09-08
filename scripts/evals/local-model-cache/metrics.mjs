import { createHmac, randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const privateKey = randomBytes(32);
export const digest = (value, key = privateKey) => createHmac('sha256', key).update(value).digest('hex');
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, function (_key, v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort(compare).map(k => [k, v[k]])) : v;
});

/** Digests are private to one collection window; never persist the HMAC key. */
export function summarizeRequest(bytes, key = privateKey) {
  const part = value => { const b = Buffer.from(JSON.stringify(value)); return { bytes: b.length, hash: digest(b, key) }; };
  const result = { body: { bytes: bytes.length, hash: digest(bytes, key) }, parseStatus: 'invalid_json' };
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return result;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const tools = Array.isArray(data.tools) ? data.tools : [];
    const definitions = tools.map(canonical);
    return { ...result, parseStatus: 'ok', modelHash: digest(canonical(data.model ?? null), key),
      system: part(messages.filter(m => m?.role === 'system')),
      history: part(messages.filter(m => m?.role !== 'system')),
      tools: { ...part(tools), count: tools.length,
        orderHash: digest(JSON.stringify(definitions), key),
        setHash: digest(JSON.stringify([...definitions].sort(compare)), key),
        schemas: tools.map(t => ({ ...part(t), nameHash: digest(canonical(t?.function?.name ?? null), key) })) },
    };
  } catch { return result; }
}

export function analyzeWindow(records) {
  const last = new Map(); let orderComparisons = 0; let orderDrifts = 0; let toolSetChanges = 0; let unavailable = 0; let failures = 0;
  for (const r of records) {
    if (r.status !== 'complete') failures++;
    if (!r.keyId || !r.scopeHash || !r.endpointHash || !r.request?.modelHash || !r.request?.tools) { unavailable++; continue; }
    const group = JSON.stringify([r.keyId, r.scopeHash, r.endpointHash, r.request.modelHash]);
    const current = r.request.tools; const previous = last.get(group); last.set(group, current);
    if (!previous) continue;
    if (previous.setHash !== current.setHash) { toolSetChanges++; continue; }
    orderComparisons++;
    if (previous.orderHash !== current.orderHash) orderDrifts++;
  }
  return { requests: records.length, orderComparisons, orderDrifts, toolSetChanges, unavailable, failures,
    driftFraction: orderComparisons ? orderDrifts / orderComparisons : null,
    decision: 'inconclusive', reason: 'diagnostic_window_only_representativeness_and_roi_not_certified' };
}

/** Observe complete SSE events without retaining model output in the report. */
export class SseMetrics {
  constructor({ maxBytes = 1024 * 1024, onContent = () => {} } = {}) {
    this.maxBytes = maxBytes; this.decoder = new StringDecoder('utf8'); this.pending = ''; this.calls = new Map(); this.retainedBytes = 0;
    this.onContent = onContent;
    this.data = { available: true, firstEffectiveDeltaMs: null, firstThinkingMs: null, firstContentMs: null,
      firstCompleteToolMs: null, sawDone: false, parseErrors: 0, providerError: false, outputTokens: null, stopReasons: [] };
  }
  disable() { this.data.available = false; this.pending = ''; this.calls.clear(); }
  push(bytes, ms) {
    if (!this.data.available) return;
    this.pending += this.decoder.write(bytes);
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.pending);
      if (!match) break;
      const frame = this.pending.slice(0, match.index); this.pending = this.pending.slice(match.index + match[0].length);
      if (Buffer.byteLength(frame) > this.maxBytes) { this.disable(); return; }
      const lines = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
      if (lines.length) this.event(lines.join('\n'), ms);
      if (!this.data.available) return;
    }
    if (Buffer.byteLength(this.pending) > this.maxBytes) this.disable();
  }
  mark(name, ms) { this.data[name] ??= ms; }
  event(text, ms) {
    if (text === '[DONE]') { this.data.sawDone = true; return; }
    let event;
    try { event = JSON.parse(text); } catch { this.data.parseErrors++; return; }
    if (!event || typeof event !== 'object') { this.data.parseErrors++; return; }
    if (event.error) this.data.providerError = true;
    if (Number.isSafeInteger(event.usage?.completion_tokens) && event.usage.completion_tokens >= 0) this.data.outputTokens = event.usage.completion_tokens;
    for (const choice of Array.isArray(event.choices) ? event.choices : []) {
      if (!choice || typeof choice !== 'object') { this.data.parseErrors++; continue; }
      const delta = choice.delta ?? {}; const index = choice.index ?? 0;
      for (const field of ['reasoning_content', 'reasoning', 'reasoning_text', 'thinking', 'thought']) {
        if (typeof delta[field] === 'string' && delta[field].trim()) { this.mark('firstThinkingMs', ms); this.mark('firstEffectiveDeltaMs', ms); }
      }
      // Raw content may include provider-specific think tags: this is a wire diagnostic, never T_visible.
      if (typeof delta.content === 'string') {
        this.onContent(delta.content);
        if (delta.content.trim()) { this.mark('firstContentMs', ms); this.mark('firstEffectiveDeltaMs', ms); }
      }
      if (this.calls.size > 1024) { this.disable(); return; }
      const calls = this.calls.get(index) ?? new Map(); this.calls.set(index, calls);
      for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        if (!Number.isSafeInteger(call?.index) || call.index < 0) { this.data.parseErrors++; continue; }
        const name = typeof call.function?.name === 'string' ? call.function.name : '';
        const args = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
        if (name || args) this.mark('firstEffectiveDeltaMs', ms);
        this.retainedBytes += Buffer.byteLength(name) + Buffer.byteLength(args);
        if (this.retainedBytes > this.maxBytes || calls.size >= 1024) { this.disable(); return; }
        const value = calls.get(call.index) ?? { name: '', args: '' }; value.name += name; value.args += args; calls.set(call.index, value);
      }
      if (choice.finish_reason) {
        const reason = ['stop', 'tool_calls', 'length', 'content_filter', 'function_call'].includes(choice.finish_reason) ? choice.finish_reason : 'other';
        if (this.data.stopReasons.length < 32) this.data.stopReasons.push(reason);
        if (reason === 'tool_calls' && calls.size && [...calls.values()].every(v => {
          try { const a = JSON.parse(v.args); return Boolean(v.name.trim()) && a !== null && typeof a === 'object' && !Array.isArray(a); } catch { return false; }
        })) this.mark('firstCompleteToolMs', ms);
        this.calls.delete(index);
      }
    }
  }
  snapshot() { return structuredClone(this.data); }
}
