// Cross-platform file path helpers for the renderer.
//
// The renderer runs the same bundle on macOS, Linux and Windows, so any logic
// that inspects file paths coming from task results or message text must handle
// both POSIX paths (`/Users/song/report.html`) and Windows paths
// (`D:\projects\xiaok-cli\report.html`). Assuming a single separator caused
// generated-file artifact cards to silently disappear on Windows.

/**
 * Returns true when `p` looks like an absolute filesystem path on any platform:
 * - POSIX absolute:        `/Users/song/report.html`
 * - Windows drive-letter:  `D:\projects\x.html` or `D:/projects/x.html`
 * - Windows UNC:           `\\server\share\x.html`
 */
export function isAbsoluteFilePath(p: string | undefined | null): boolean {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\')) return true;
  return false;
}

/**
 * Returns the final path segment, splitting on both `/` and `\` so Windows
 * paths don't get treated as a single file name.
 */
export function fileBasename(p: string | undefined | null): string {
  if (!p) return '';
  const normalized = p.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Builds a `file://` URL that the main process `resolveLocalFileOpenPath`
 * helper can parse on both platforms. Windows drive paths become
 * `file:///D:/projects/x.html`; POSIX paths become `file:///Users/song/x.html`.
 * Backslashes are normalized to forward slashes; `new URL` (used downstream)
 * percent-encodes the remaining characters such as spaces.
 */
export function toFileUrl(p: string): string {
  const forward = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(forward)) return `file:///${forward}`;
  return `file://${forward}`;
}

/**
 * Strips the longest common directory prefix shared by all given paths so the
 * remaining labels are short and relative. Normalizes separators (works for
 * POSIX and Windows paths) and is root-agnostic — no hardcoded cwd. Used to
 * render changed-file trees without leaking absolute machine paths.
 */
export function relativizePaths(absPaths: string[]): string[] {
  const normalized = absPaths.map(p => p.replace(/\\/g, '/'));
  if (normalized.length === 0) return normalized;
  const splitParts = normalized.map(p => p.split('/'));
  const first = splitParts[0];
  let prefixLen = 0;
  for (let i = 0; i < first.length - 1; i++) {
    const seg = first[i];
    if (splitParts.every(parts => parts[i] === seg)) prefixLen = i + 1;
    else break;
  }
  if (prefixLen === 0) return normalized;
  return splitParts.map(parts => parts.slice(prefixLen).join('/'));
}
