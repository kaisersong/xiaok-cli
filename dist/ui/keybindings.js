import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
const DEFAULT_BINDINGS = [
    { key: 'enter', action: 'submit' },
    { key: 'ctrl+j', action: 'newline' },
    { key: 'shift+enter', action: 'newline' },
    { key: 'up', action: 'history-prev' },
    { key: 'down', action: 'history-next' },
    { key: 'left', action: 'cursor-left' },
    { key: 'right', action: 'cursor-right' },
    { key: 'home', action: 'cursor-home' },
    { key: 'end', action: 'cursor-end' },
    { key: 'ctrl+a', action: 'cursor-home' },
    { key: 'ctrl+e', action: 'cursor-end' },
    { key: 'ctrl+left', action: 'word-left' },
    { key: 'ctrl+right', action: 'word-right' },
    { key: 'backspace', action: 'delete-back' },
    { key: 'ctrl+w', action: 'delete-word-back' },
    { key: 'ctrl+u', action: 'delete-to-start' },
    { key: 'ctrl+k', action: 'delete-to-end' },
    { key: 'ctrl+y', action: 'yank' },
    { key: 'ctrl+z', action: 'undo' },
    { key: 'ctrl+shift+z', action: 'redo' },
    { key: 'ctrl+r', action: 'search-history' },
    { key: 'ctrl+l', action: 'clear-screen' },
    { key: 'ctrl+c', action: 'cancel' },
    { key: 'ctrl+d', action: 'eof' },
    { key: 'escape', action: 'escape' },
    { key: 'tab', action: 'tab' },
    { key: 'shift+tab', action: 'shift-tab' },
];
let bindingMap = null;
function buildDefaultBindingMap() {
    const map = new Map();
    for (const b of DEFAULT_BINDINGS) {
        map.set(b.key, b.action);
    }
    return map;
}
function getKeybindingsPath() {
    const configDir = process.env.XIAOK_CONFIG_DIR ?? path.join(os.homedir(), '.xiaok');
    return path.join(configDir, 'keybindings.json');
}
export function loadKeybindingsSync() {
    const map = buildDefaultBindingMap();
    const configPath = getKeybindingsPath();
    try {
        const raw = readFileSync(configPath, 'utf-8');
        const entries = JSON.parse(raw);
        if (Array.isArray(entries)) {
            for (const e of entries) {
                if (e.key && e.action) {
                    map.set(e.key, e.action);
                }
            }
        }
    }
    catch {
        // Config file doesn't exist or is invalid, use defaults
    }
    bindingMap = map;
    return map;
}
export async function loadKeybindings() {
    const map = buildDefaultBindingMap();
    const configPath = getKeybindingsPath();
    try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const entries = JSON.parse(raw);
        if (Array.isArray(entries)) {
            for (const e of entries) {
                if (e.key && e.action) {
                    map.set(e.key, e.action);
                }
            }
        }
    }
    catch {
        // Config file doesn't exist or is invalid, use defaults
    }
    bindingMap = map;
    return map;
}
export function getBindingMap() {
    if (!bindingMap) {
        bindingMap = buildDefaultBindingMap();
    }
    return bindingMap;
}
export function resolveAction(keyName) {
    return getBindingMap().get(keyName);
}
export function identifyKey(data, offset) {
    const ch = data[offset];
    if (ch === '\x1b') {
        if (offset + 1 < data.length && data[offset + 1] === '[') {
            let i = offset + 2;
            let params = '';
            while (i < data.length && data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x3f) {
                params += data[i];
                i++;
            }
            if (i >= data.length)
                return { key: 'escape', consumed: 1 };
            const finalByte = data[i];
            const seq = params + finalByte;
            // CSI sequences
            const csiMap = {
                'A': 'up',
                'B': 'down',
                'C': 'right',
                'D': 'left',
                'H': 'home',
                'F': 'end',
                '1;5C': 'ctrl+right',
                '1;5D': 'ctrl+left',
                'Z': 'shift+tab',
                '13;2u': 'shift+enter',
                '122;6u': 'ctrl+shift+z',
                '3~': 'delete',
            };
            const key = csiMap[seq];
            if (key) {
                return { key, consumed: i - offset + 1 };
            }
            return { key: 'escape', consumed: 1 };
        }
        // Bare escape
        return { key: 'escape', consumed: 1 };
    }
    // Control characters
    const code = data.charCodeAt(offset);
    const ctrlMap = {
        0x01: 'ctrl+a',
        0x03: 'ctrl+c',
        0x04: 'ctrl+d',
        0x05: 'ctrl+e',
        0x08: 'backspace',
        0x09: 'tab',
        0x0a: 'ctrl+j',
        0x0b: 'ctrl+k',
        0x0c: 'ctrl+l',
        0x0d: 'enter',
        0x12: 'ctrl+r',
        0x15: 'ctrl+u',
        0x17: 'ctrl+w',
        0x19: 'ctrl+y',
        0x1a: 'ctrl+z',
        0x7f: 'backspace',
    };
    const key = ctrlMap[code];
    if (key) {
        return { key, consumed: 1 };
    }
    // Printable characters - return null to indicate they should be handled as text
    return null;
}
