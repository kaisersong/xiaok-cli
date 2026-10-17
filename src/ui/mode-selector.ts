import { stdin } from 'node:process';
import type { PermissionMode } from '../ai/permissions/manager.js';
import type { ReplRenderer } from './repl-renderer.js';
import { pauseInputForHandoff } from './input-mode.js';
import { normalizeEnhancedKeys, retainKeyboardProtocol } from './keyboard-protocol.js';
import { identifyKey } from './keybindings.js';

const modes: Array<{ mode: PermissionMode; description: string }> = [
  { mode: 'default', description: '危险操作前询问确认' },
  { mode: 'auto', description: '低风险自动执行，高风险仍确认' },
  { mode: 'plan', description: '只做计划，不执行写入和命令' },
  { mode: 'yolo', description: '所有命令自动执行，跳过命令风险拦截' },
];

/** A local user choice; the caller applies it to the live permission manager. */
export async function selectPermissionMode(
  current: PermissionMode,
  { renderer }: { renderer: ReplRenderer },
): Promise<PermissionMode | null> {
  if (!stdin.isTTY) return null;
  let selected = modes.findIndex(option => option.mode === current);
  if (selected < 0) selected = 0;

  return new Promise(resolve => {
    let settled = false;
    let releaseKeyboard = () => {};
    const draw = () => {
      const state = renderer.getState();
      renderer.renderInput({
        prompt: state.prompt || 'Type your message...', input: '', cursor: 0,
        footerLines: state.footerLines,
        overlayLines: [
          `选择权限模式（当前：${current}）`,
          ...modes.map((option, index) => `  ${index === selected ? '❯' : ' '} ${index + 1}. ${option.mode}${option.mode === current ? '（当前）' : ''} — ${option.description}`),
          '↑↓ 选择 · 1–4 直选 · Enter 确认 · Esc 取消',
        ],
      }, 'question');
    };
    const done = (mode: PermissionMode | null) => {
      if (settled) return;
      settled = true;
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      releaseKeyboard();
      pauseInputForHandoff();
      renderer.clearOverlay();
      resolve(mode);
    };
    const onEnd = () => done(null);
    const onData = (data: Buffer | string) => {
      const keys = normalizeEnhancedKeys(Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8');
      for (let offset = 0; offset < keys.length && !settled;) {
        const identified = identifyKey(keys, offset);
        const key = identified?.key ?? keys[offset]!;
        offset += identified?.consumed ?? 1;
        if (['escape', 'ctrl+c', 'ctrl+d'].includes(key)) { done(null); return; }
        if (key === 'enter' || key === 'ctrl+j') { done(modes[selected]!.mode); return; }
        if (/^[1-4]$/.test(key)) { done(modes[Number(key) - 1]!.mode); return; }
        if (key === 'up' || key === 'down') {
          selected = (selected + (key === 'up' ? -1 : 1) + modes.length) % modes.length;
          draw();
        }
      }
    };
    draw();
    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.setRawMode?.(true);
    releaseKeyboard = retainKeyboardProtocol();
    stdin.resume();
  });
}
