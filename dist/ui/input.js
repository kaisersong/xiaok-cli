import * as readline from 'readline';
import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
import { appendFileSync } from 'fs';
const DEBUG_LOG = '/tmp/xiaok-debug.log';
function log(msg) {
    try {
        appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
    }
    catch { }
}
const BASE_SLASH_COMMANDS = [
    { cmd: '/exit', desc: 'Exit the chat' },
    { cmd: '/clear', desc: 'Clear the screen' },
    { cmd: '/models', desc: 'Switch model' },
    { cmd: '/help', desc: 'Show help' },
];
/** 向左找词边界（Ctrl+W / Alt+Left 用） */
export function wordBoundaryLeft(text, cursor) {
    let i = cursor;
    // 跳过光标左侧的空白
    while (i > 0 && text[i - 1] === ' ')
        i--;
    // 跳过非空白（即当前词）
    while (i > 0 && text[i - 1] !== ' ')
        i--;
    return i;
}
/** 向右找词边界（Alt+Right 用） */
export function wordBoundaryRight(text, cursor) {
    let i = cursor;
    // 跳过空白
    while (i < text.length && text[i] === ' ')
        i++;
    // 跳过非空白（下一个词）
    while (i < text.length && text[i] !== ' ')
        i++;
    return i;
}
export function getSlashCommands(skills) {
    const commands = [...BASE_SLASH_COMMANDS];
    for (const skill of skills) {
        const cmd = `/${skill.name}`;
        if (!commands.some((c) => c.cmd === cmd)) {
            commands.push({ cmd, desc: skill.description });
        }
    }
    return commands.sort((a, b) => a.cmd.localeCompare(b.cmd));
}
export class InputReader {
    history = [];
    historyIdx = 0;
    menuOpen = false;
    menuItems = [];
    menuIdx = 0;
    skills = [];
    setSkills(skills) {
        this.skills = skills;
    }
    async read(prompt) {
        if (!stdin.isTTY) {
            const rl = readline.createInterface({ input: stdin, output: stdin });
            return new Promise((resolve) => {
                rl.question(prompt, (answer) => {
                    rl.close();
                    resolve(answer);
                });
            });
        }
        return new Promise((resolve) => {
            let input = '';
            let cursor = 0;
            let resolved = false;
            const redraw = () => {
                stdout.write(`\r\x1b[K${prompt}${input}`);
                const back = input.length - cursor;
                if (back > 0)
                    stdout.write(`\x1b[${back}D`);
            };
            const renderMenu = () => {
                if (this.menuItems.length === 0)
                    return;
                log(`renderMenu: items=${this.menuItems.length} idx=${this.menuIdx}`);
                // 保存当前光标位置（相对于输入行）
                const cursorOffset = input.length - cursor;
                // 菜单显示在输入框下方
                // 输出菜单项
                for (let m = 0; m < this.menuItems.length; m++) {
                    const item = this.menuItems[m];
                    const isSelected = m === this.menuIdx;
                    const prefix = isSelected ? boldCyan('\u276f') : ' ';
                    const cmdStr = isSelected ? boldCyan(item.cmd) : dim(item.cmd);
                    const descStr = dim(item.desc);
                    stdout.write(`\n  ${prefix} ${cmdStr}  ${descStr}`);
                }
                // 向上移动光标回到输入行
                stdout.write(`\x1b[${this.menuItems.length}A`);
                // 恢复光标位置
                if (cursorOffset > 0)
                    stdout.write(`\x1b[${cursorOffset}D`);
            };
            const clearMenu = () => {
                if (this.menuItems.length === 0)
                    return;
                // 向上移动到菜单区域
                stdout.write(`\x1b[${this.menuItems.length}A`);
                // 清除每一行
                for (let m = 0; m < this.menuItems.length; m++) {
                    stdout.write('\x1b[2K');
                    if (m < this.menuItems.length - 1) {
                        stdout.write('\n');
                    }
                }
                // 回到输入行开头
                stdout.write('\r');
            };
            const getFilteredCommands = (text) => getSlashCommands(this.skills).filter((c) => c.cmd.startsWith(text));
            const openMenu = (text) => {
                log(`openMenu: text=${JSON.stringify(text)}`);
                this.menuItems = getFilteredCommands(text);
                log(`openMenu: filtered items=${this.menuItems.length}`);
                if (this.menuItems.length > 0) {
                    this.menuIdx = 0;
                    this.menuOpen = true;
                    renderMenu();
                }
                else {
                    this.menuOpen = false;
                }
            };
            const updateMenu = (text) => {
                if (this.menuOpen)
                    clearMenu();
                this.menuItems = getFilteredCommands(text);
                if (this.menuItems.length > 0) {
                    this.menuIdx = Math.min(this.menuIdx, this.menuItems.length - 1);
                    this.menuOpen = true;
                    renderMenu();
                }
                else {
                    this.menuOpen = false;
                }
            };
            const closeMenu = () => {
                if (this.menuOpen) {
                    clearMenu();
                    this.menuOpen = false;
                    this.menuItems = [];
                    this.menuIdx = 0;
                }
            };
            const done = (result) => {
                if (resolved)
                    return;
                resolved = true;
                closeMenu();
                stdin.removeListener('data', onData);
                stdin.setRawMode(false);
                stdin.pause();
                // 不清除输入行，因为输入行是固定位置的
                // 只需要换行即可
                if (result !== null && result.trim()) {
                    this.history.push(result);
                }
                this.historyIdx = this.history.length;
                resolve(result);
            };
            const onData = (data) => {
                const key = data.toString('utf8');
                log(`key pressed: ${JSON.stringify(key)} input=${JSON.stringify(input)} cursor=${cursor}`);
                if (key === '\x03') {
                    done(null);
                    return;
                }
                if (key === '\x04' && input.length === 0) {
                    done(null);
                    return;
                }
                if (key === '\r' || key === '\n') {
                    if (this.menuOpen && this.menuItems.length > 0) {
                        const selected = this.menuItems[this.menuIdx].cmd;
                        input = selected;
                        cursor = selected.length;
                        closeMenu();
                        redraw();
                        return;
                    }
                    if (input.trim()) {
                        done(input);
                    }
                    return;
                }
                if (key === '\x7f' || key === '\b') {
                    if (cursor > 0) {
                        input = input.slice(0, cursor - 1) + input.slice(cursor);
                        cursor--;
                        redraw();
                        if (input.startsWith('/')) {
                            updateMenu(input);
                        }
                        else {
                            closeMenu();
                        }
                    }
                    return;
                }
                if (key === '\x1b[D') {
                    if (cursor > 0) {
                        cursor--;
                        stdout.write('\x1b[D');
                    }
                    return;
                }
                if (key === '\x1b[C') {
                    if (cursor < input.length) {
                        cursor++;
                        stdout.write('\x1b[C');
                    }
                    return;
                }
                if (key === '\x1b[A') {
                    if (this.menuOpen) {
                        clearMenu();
                        this.menuIdx = (this.menuIdx - 1 + this.menuItems.length) % this.menuItems.length;
                        renderMenu();
                    }
                    else if (this.historyIdx > 0) {
                        this.historyIdx--;
                        input = this.history[this.historyIdx];
                        cursor = input.length;
                        redraw();
                    }
                    return;
                }
                if (key === '\x1b[B') {
                    if (this.menuOpen) {
                        clearMenu();
                        this.menuIdx = (this.menuIdx + 1) % this.menuItems.length;
                        renderMenu();
                    }
                    else if (this.historyIdx < this.history.length - 1) {
                        this.historyIdx++;
                        input = this.history[this.historyIdx];
                        cursor = input.length;
                        redraw();
                    }
                    else if (this.historyIdx === this.history.length - 1) {
                        this.historyIdx = this.history.length;
                        input = '';
                        cursor = 0;
                        redraw();
                    }
                    return;
                }
                if (key === '\x1b[H' || key === '\x01') {
                    cursor = 0;
                    redraw();
                    return;
                }
                if (key === '\x1b[F' || key === '\x05') {
                    cursor = input.length;
                    redraw();
                    return;
                }
                if (key === '\t') {
                    if (this.menuOpen && this.menuItems.length > 0) {
                        const selected = this.menuItems[this.menuIdx].cmd;
                        input = selected;
                        cursor = selected.length;
                        closeMenu();
                        redraw();
                    }
                    else if (input.startsWith('/')) {
                        const matches = getFilteredCommands(input);
                        if (matches.length === 1) {
                            input = matches[0].cmd;
                            cursor = matches[0].cmd.length;
                            redraw();
                        }
                        else if (matches.length > 1) {
                            openMenu(input);
                        }
                    }
                    return;
                }
                // Ctrl+W — 删除光标左侧一个词
                if (key === '\x17') {
                    const newCursor = wordBoundaryLeft(input, cursor);
                    if (newCursor < cursor) {
                        input = input.slice(0, newCursor) + input.slice(cursor);
                        cursor = newCursor;
                        redraw();
                        if (input.startsWith('/') && input.length > 0) {
                            updateMenu(input);
                        }
                        else {
                            closeMenu();
                        }
                    }
                    return;
                }
                // Alt+Left (ESC b) — 词跳左
                if (key === '\x1bb') {
                    cursor = wordBoundaryLeft(input, cursor);
                    redraw();
                    return;
                }
                // Alt+Right (ESC f) — 词跳右
                if (key === '\x1bf') {
                    cursor = wordBoundaryRight(input, cursor);
                    redraw();
                    return;
                }
                if (key === '\x1b') {
                    if (this.menuOpen) {
                        closeMenu();
                    }
                    return;
                }
                if (key.length >= 1 && key >= ' ' && !/[\x1b\x7f]/.test(key)) {
                    input = input.slice(0, cursor) + key + input.slice(cursor);
                    cursor += key.length;
                    redraw();
                    if (input.startsWith('/')) {
                        if (this.menuOpen) {
                            updateMenu(input);
                        }
                        else {
                            openMenu(input);
                        }
                    }
                    else if (this.menuOpen) {
                        closeMenu();
                    }
                }
            };
            stdout.write(prompt);
            stdin.setRawMode(true);
            stdin.resume();
            stdin.on('data', onData);
        });
    }
}
