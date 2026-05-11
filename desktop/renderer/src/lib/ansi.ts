/**
 * Strip ANSI escape sequences (SGR color codes, styles, cursor movements)
 * from shell output strings so they render cleanly in React components.
 */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}
