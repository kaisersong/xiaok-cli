import { Ghostty } from '@gkoreli/ghostty-vt-js/browser-terminal';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Pinned test dependency: its high-level formatter drops background-only cells.
// Read the actual VT cells instead, including scrollback, so a blank gray band
// cannot disappear from the oracle merely because it has no printable text.
export async function createGhosttyVt(columns = 110, rows = 40) {
  const loader = new URL('./dist/terminal-screen-emulator/wasm-loader.js', pathToFileURL(createRequire(import.meta.url).resolve('@gkoreli/ghostty-vt-js/package.json')));
  const { instantiateEmulator } = await import(loader.href);
  const terminal = Ghostty.fromInstance(await instantiateEmulator()).createTerminal({ cols: columns, rows, maxScrollback: 2000 });
  const snapshot = () => {
    terminal.update();
    const history = Array.from({ length: terminal.getScrollbackLength() }, (_, i) => terminal.getScrollbackLine(i) ?? []);
    const viewport = Array.from({ length: terminal.rows }, (_, i) => terminal.getLine(i) ?? []);
    const lines = history.concat(viewport);
    return {
      text: lines.map(cells => cells.map(cell => cell.width === 0 ? '' : String.fromCodePoint(cell.codepoint || 32)).join('').trimEnd()).join('\n'),
      grayRows: lines.flatMap((cells, row) => cells.some(cell => cell.bg_r === 68 && cell.bg_g === 68 && cell.bg_b === 68) ? [row] : []),
      cursor: terminal.getCursor(),
    };
  };
  return { terminal, snapshot };
}
