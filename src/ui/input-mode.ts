import { stdin } from 'node:process';

let owners = 0;
let originalRawMode = false;

/** Keep internal reader handoffs raw: cooked reads can translate or lose Enter. */
export function retainRawInputModeForSession(): () => void {
  if (!stdin.isTTY) return () => {};
  if (owners++ === 0) originalRawMode = Boolean(stdin.isRaw);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners === 0) stdin.setRawMode(originalRawMode);
  };
}

/** Only for internal reader handoffs; external terminal owners must still set cooked mode. */
export function pauseInputForHandoff(): void {
  if (owners === 0) stdin.setRawMode(false);
  stdin.pause();
}
