import { stdin, stdout } from 'node:process';

let owners = 0;

function restoreKeyboardProtocol(): void {
  if (owners === 0) return;
  owners = 0;
  process.removeListener('exit', restoreKeyboardProtocol);
  stdout.write('\x1b[<u');
}

/** Request only key disambiguation; keep text/IME input and legacy Enter intact. */
export function retainKeyboardProtocol(): () => void {
  if (!stdin.isTTY || !stdout.isTTY) return () => {};
  if (owners === 0) {
    try { stdout.write('\x1b[>1u'); } catch { return () => {}; }
    process.once('exit', restoreKeyboardProtocol);
  }
  owners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (owners > 1) owners--;
    else restoreKeyboardProtocol();
  };
}

/** Preserve the existing control-key and Ctrl+C owner paths for CSI-u terminals. */
export function normalizeEnhancedKeys(bytes: Buffer): Buffer {
  if (!bytes.includes(0x1b)) return bytes;
  // latin1 is lossless for split UTF-8 chunks; InputReader's StringDecoder owns UTF-8.
  const normalized = bytes.toString('latin1').replace(
    /\x1b\[(\d+)(?:;(\d+))?u/g,
    (sequence: string, codeText: string, modifierText: string | undefined) => {
      const code = Number(codeText);
      const modifier = Number(modifierText ?? 1);
      if (modifier === 5 && code >= 97 && code <= 122) {
        return String.fromCharCode(code - 96);
      }
      if (modifier === 2 && code === 9) return '\x1b[Z';
      if (modifier === 1 && [9, 13, 27, 127].includes(code)) {
        return String.fromCharCode(code);
      }
      return sequence;
    },
  );
  return Buffer.from(normalized, 'latin1');
}
