import { stdin, stdout } from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import type { ReplRenderer } from './repl-renderer.js';
import { pauseInputForHandoff } from './input-mode.js';
import { normalizeEnhancedKeys, retainKeyboardProtocol } from './keyboard-protocol.js';
import { identifyKey } from './keybindings.js';
import { getDisplayWidth, truncateAnsi, stripAnsi } from './text-metrics.js';
import { DEFAULT_STATUSLINE_FIELDS, STATUSLINE_FIELDS, normalizeStatuslineFields, type StatusBarField } from './statusline-preferences.js';

type EditableField = Exclude<StatusBarField, 'session'>;
interface SelectorOptions {
  renderer: ReplRenderer;
  preview: (fields: StatusBarField[]) => string;
}
const actions = ['恢复默认并保存', '全部关闭并保存', '保存设置', '取消'];

export async function selectStatuslineFields(current: StatusBarField[], {renderer, preview}: SelectorOptions): Promise<StatusBarField[] | null> {
  if (!stdin.isTTY) return null;
  const checked = normalizeStatuslineFields(current).filter((field): field is EditableField => field !== 'session');
  const order = [...checked, ...(Object.keys(STATUSLINE_FIELDS) as EditableField[]).filter(field => !checked.includes(field))];
  const items = order.map(field => ({field, enabled: checked.includes(field)}));
  let selected = 0;
  const fields = (): StatusBarField[] => items.filter(item => item.enabled).map(item => item.field);

  return new Promise((resolve, reject) => {
    let settled = false;
    let releaseKeyboard = () => {};
    const decoder = new StringDecoder('utf8');
    let pendingKeys = '';
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: StatusBarField[] | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(escapeTimer); pendingKeys = '';
      let failure = error;
      for (const cleanup of [
        () => stdin.removeListener('data', onData), () => stdin.removeListener('end', onEnd),
        () => stdout.removeListener('resize', redraw), () => releaseKeyboard(),
        () => pauseInputForHandoff(), () => renderer.clearOverlay(),
      ]) {
        try { cleanup(); } catch (cause) { failure ??= cause; }
      }
      if (failure !== undefined) reject(failure); else resolve(result);
    };
    const draw = () => {
      const action = selected - items.length;
      const candidate = action === 0 ? [...DEFAULT_STATUSLINE_FIELDS] : action === 1 ? [] : fields();
      const text = stripAnsi(preview(candidate)) || (candidate.length ? '（当前无可显示内容）' : '（已关闭）');
      const rows = stdout.rows ?? 24;
      const compact = rows <= 14;
      const width = Math.max(0, (stdout.columns ?? 80) - (compact ? 18 : 8));
      const shortened = getDisplayWidth(text) > width
        ? truncateAnsi(text, Math.max(0, width - 1)) + (width ? '…' : '') : text;
      const state = renderer.getState();
      renderer.renderInput({
        prompt: state.prompt || 'Type your message...', input: '', cursor: 0,
        footerLines: state.footerLines,
        overlayLines: [
          ...(rows <= 12 ? [] : compact ? [`自定义状态栏 · ${shortened}`] : ['自定义状态栏', `预览：${shortened}`]),
          ...items.map((item, index) => `  ${index === selected ? '❯' : ' '} ${index + 1}. [${item.enabled ? 'x' : ' '}] ${STATUSLINE_FIELDS[item.field]} (${item.field})`),
          ...actions.map((label, index) => `  ${index + items.length === selected ? '❯' : ' '} ${index + items.length + 1}. ${label}`),
          selected < items.length ? '↑↓选 空格选 ←→移 Enter保存 Esc取消' : '↑↓ 选择 · Enter 执行 · Esc 取消',
        ],
      }, 'question');
    };
    const redraw = () => {
      if (settled) return;
      try { draw(); } catch (error) { finish(null, error); }
    };
    const onEnd = () => finish(null);
    const onData = (data: Buffer | string) => {
      try {
        clearTimeout(escapeTimer);
        pendingKeys += typeof data === 'string' ? data : decoder.write(data);
        const keys = normalizeEnhancedKeys(Buffer.from(pendingKeys)).toString('utf8');
        let offset = 0;
        for (; offset < keys.length && !settled;) {
          const tail = keys.slice(offset);
          if (tail === '\x1b') break;
          let identified: ReturnType<typeof identifyKey>;
          if (tail.startsWith('\x1b[') || tail.startsWith('\x1bO')) {
            const sequence = tail.match(/^\x1b(?:\[|O)[0-?]*[ -/]*[@-~]/)?.[0];
            if (!sequence) {
              const control = tail.slice(2).search(/[\x00-\x1f]/);
              if (control >= 0) { offset += 2 + control; continue; }
              break;
            }
            identified = tail.startsWith('\x1bO')
              ? {key: ({A:'up', B:'down', C:'right', D:'left', H:'home', F:'end'} as Record<string,string>)[sequence.slice(2)] ?? 'unknown-csi', consumed: sequence.length}
              : identifyKey(keys, offset);
          } else identified = identifyKey(keys, offset);
          const key = identified?.key ?? String.fromCodePoint(keys.codePointAt(offset)!);
          offset += identified?.consumed ?? key.length;
          if (['escape', 'ctrl+c', 'ctrl+d'].includes(key)) { finish(null); return; }
          if (key === 'enter' || key === 'ctrl+j') {
            const action = selected - items.length;
            finish(action === 0 ? [...DEFAULT_STATUSLINE_FIELDS] : action === 1 ? [] : action === 3 ? null : fields());
            return;
          }
          if (key === 'up' || key === 'down') {
            selected = (selected + (key === 'up' ? -1 : 1) + items.length + actions.length) % (items.length + actions.length);
          } else if (key === 'home') selected = 0;
          else if (key === 'end') selected = items.length + actions.length - 1;
          else if (key === ' ' && selected < items.length) items[selected]!.enabled = !items[selected]!.enabled;
          else if ((key === 'left' || key === 'right') && selected < items.length) {
            const next = selected + (key === 'left' ? -1 : 1);
            if (next >= 0 && next < items.length) {
              [items[selected], items[next]] = [items[next]!, items[selected]!]; selected = next;
            }
          } else continue;
          draw();
        }
        if (!settled) {
          pendingKeys = keys.slice(offset);
          if (pendingKeys === '\x1b') escapeTimer = setTimeout(() => finish(null), 30);
        }
      } catch (error) { finish(null, error); }
    };
    try {
      stdin.on('data', onData); stdin.once('end', onEnd); stdout.on('resize', redraw);
      stdin.setRawMode?.(true); releaseKeyboard = retainKeyboardProtocol();
      draw(); if (!settled) stdin.resume();
    } catch (error) { finish(null, error); }
  });
}
