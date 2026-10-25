import type { PermissionModalState } from './modal-state.js';
import type { ScrollPromptFrame } from './scroll-region.js';
import { escapeProjectRuleDisplay, formatPermissionPromptLines } from './permission-prompt.js';
import { getUiCopy } from './locale.js';
import { getDisplayWidth, truncateAnsi } from './text-metrics.js';

/** Draw only in a caller-owned alternate screen; never mutate the transcript. */
export class PermissionScreen {
  private pageIndex = 0;
  private pages = 1;
  private layoutKey = '';
  private reviewed = new Set<number>();
  private fits = false;

  constructor(private readonly stream: NodeJS.WriteStream) {}

  page(delta: number): void {
    this.pageIndex = Math.max(0, Math.min(this.pages - 1, this.pageIndex + delta));
  }

  canApprove(): boolean { return this.fits && this.reviewed.size === this.pages; }

  render(modal: PermissionModalState, frame: ScrollPromptFrame): void {
    const rows = this.stream.rows ?? 24;
    const columns = this.stream.columns ?? 80;
    const copy = getUiCopy('zh-CN');
    const inputRow = rows - 2;
    const summaryRow = frame.summaryLine ? inputRow - 3 : -1;
    // Three blank rows above input, with an optional summary inside the gap.
    const overlayBottom = inputRow - 4 - (frame.summaryLine ? 1 : 0);
    const formatted = formatPermissionPromptLines(modal.toolName, {}, modal.options.map((label, i) => ({label, selected: i === modal.selectedIndex})));
    const header = formatted.slice(0, 2);
    const choices = formatted.slice(2, -1);
    const hint = formatted.at(-1)!;
    const margin = process.platform === 'win32' && process.env.TMUX ? 2 : 1;
    const width = Math.max(1, columns - margin);
    // Only producer styling is removed; remaining controls are shown literally.
    const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
    const safe = (text: string) => escapeProjectRuleDisplay(plain(text));
    const wrap = (text: string): string[] => {
      const result: string[] = []; let line = '';
      for (const character of text) {
        if (getDisplayWidth(line + character) > width && line) { result.push(line); line = ''; }
        line += character;
      }
      if (line) result.push(line);
      return result;
    };
    const body = modal.targetLines.map(safe);
    // Every real rule retains control/Cf protection, even when the producer
    // intentionally emits no bash-style scope row (e.g. read/write/web tools).
    let scopeIdentityVisible = (modal.reviewRules ?? modal.reviewScopes ?? [])
      .every(rule => escapeProjectRuleDisplay(rule) === rule);
    // Each policy scope must bind to exactly one producer display line. Scope
    // identities that do not fit get complete physical lines before pagination.
    for (const scope of modal.reviewScopes ?? []) {
      const full = copy.commandApprovalScope(scope);
      const matches = body.map((line, index) => line === safe(full) ? index : -1).filter(index => index >= 0);
      if (matches.length !== 1) { scopeIdentityVisible = false; continue; }
      const index = matches[0];
      body[index] = escapeProjectRuleDisplay(full);
      const identity = escapeProjectRuleDisplay(full.slice(0, full.indexOf(scope) + scope.length));
      if (escapeProjectRuleDisplay(scope) !== scope) scopeIdentityVisible = false;
      if (getDisplayWidth(identity) > width) body.splice(index, 1, ...wrap(escapeProjectRuleDisplay(full)));
    }
    // A producer cannot claim scope rows without their structured identities.
    const scopePrefix = copy.commandApprovalScope('').split('（')[0];
    if (body.filter(line => line.startsWith(scopePrefix)).length !== (modal.reviewScopes?.length ?? 0)) scopeIdentityVisible = false;
    const fullRows = header.length + body.length + choices.length + 1;
    const paginated = fullRows > overlayBottom;
    const bodyBudget = overlayBottom - header.length - choices.length - (paginated ? 2 : 1);
    this.fits = bodyBudget >= Math.min(1, body.length)
      && width >= Math.max(...header.map(line => getDisplayWidth(safe(line))))
      && body.every(line => ![...line].some(character => getDisplayWidth(character) > width));
    this.pages = this.fits && paginated ? Math.max(1, Math.ceil(body.length / bodyBudget)) : 1;
    const layoutKey = JSON.stringify([rows, columns, this.pages, modal.toolName, body, modal.options, modal.reviewScopes, modal.reviewRules]);
    if (layoutKey !== this.layoutKey) {
      this.layoutKey = layoutKey;
      this.pageIndex = 0;
      this.reviewed.clear();
    }
    this.reviewed.delete(this.pageIndex);
    this.stream.write('\x1b[r\x1b[0m\x1b[?25l\x1b[2J\x1b[H');
    const row = (at: number, text: string) => {
      if (at < 1 || at > rows) return;
      this.stream.write(`\x1b[${at};1H\x1b[2K${truncateAnsi(safe(text), width)}\x1b[0m`);
    };
    if (this.fits) {
      const targets = paginated ? body.slice(this.pageIndex * bodyBudget, (this.pageIndex + 1) * bodyBudget) : body;
      const lines = [...header, ...targets,
        ...(paginated ? [copy.permissionReviewPage(this.pageIndex + 1, this.pages)] : []), ...choices, scopeIdentityVisible ? hint : copy.permissionUnsafeScope];
      const start = overlayBottom - lines.length + 1;
      lines.forEach((text, index) => row(start + index, text));
    } else {
      row(1, header[0]);
      row(2, copy.permissionScreenTooSmall);
    }
    if (summaryRow > 2) row(summaryRow, frame.summaryLine!);
    const glyph = process.platform === 'win32' && process.env.TMUX ? '>' : '❯';
    // The original draft remains in the controller and main screen; no mutation.
    row(inputRow, `${glyph} ${(frame.inputValue || frame.placeholder).replace(/\s/g, ' ')}`);
    row(rows, frame.statusLine);
    this.stream.write(`\x1b[${Math.max(1, inputRow - 1)};1H`);
    // Logical visits are insufficient: only a complete successful physical
    // paint, including footer/cursor, can satisfy this presentation condition.
    if (this.fits && scopeIdentityVisible) this.reviewed.add(this.pageIndex);
  }
}
