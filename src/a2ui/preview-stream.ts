import { compileRenderUiToA2ui } from './compiler.js';
import { MAX_UI_BYTES, parseUiJson } from './json-budget.js';
import type { A2UIV1Message } from './protocol.js';
export interface RenderUiPreview {
  title: string;
  content: string;
  toolUseId: string;
}
/** Snapshots are emitted only at closed top-level section boundaries, never repaired strings. */
export class RenderUiPreviewStream {
  private calls = new Map<string, { closed: boolean; count: number; at: number }>();
  isClosed(id: string): boolean {
    return this.calls.get(id)?.closed ?? false;
  }
  reset(): void {
    this.calls.clear();
  }
  finish(id: string): void {
    this.calls.set(id, { closed: true, count: 0, at: 0 });
  }
  update(id: string, input: string, now = Date.now()): RenderUiPreview | null {
    if (!id || id.length > 256 || this.calls.size > 100 || this.calls.get(id)?.closed) return null;
    const state = this.calls.get(id) ?? { closed: false, count: 0, at: -Infinity };
    this.calls.set(id, state);
    if (input.length > MAX_UI_BYTES || new TextEncoder().encode(input).length > MAX_UI_BYTES) {
      state.closed = true;
      return null;
    }
    try {
      // Token scan respects strings/escapes and nesting; only root title/sections are used.
      let depth = 0,
        quoted = false,
        escape = false,
        end = 0;
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quoted) {
          if (escape) escape = false;
          else if (ch === '\\') escape = true;
          else if (ch === '"') quoted = false;
          continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{' || ch === '[') {
          if (++depth > 24) {
            state.closed = true;
            return null;
          }
        } else if (ch === '}' || ch === ']') {
          depth--;
          if (ch === '}' && depth === 2) end = i + 1;
        }
      }
      let candidate: unknown;
      try {
        candidate = parseUiJson(input);
      } catch {
        if (!end) return null;
        candidate = parseUiJson(input.slice(0, end) + ']}');
      }
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const value = candidate as Record<string, unknown>;
      if (
        typeof value.title !== 'string' ||
        !Array.isArray(value.sections) ||
        !value.sections.length ||
        value.sections.length === state.count
      )
        return null;
      const compiled = compileRenderUiToA2ui(
        { title: value.title, sections: value.sections as never },
        { taskId: 'preview', toolUseId: id },
      );
      // Throttle publication only; malformed snapshots must close immediately.
      if (now - state.at < 100) return null;
      state.count = value.sections.length;
      state.at = now;
      return {
        toolUseId: id,
        title: value.title,
        content: JSON.stringify(compiled.messages satisfies A2UIV1Message[]),
      };
    } catch {
      state.closed = true;
      return null;
    }
  }
}
