import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
export async function selectYZJChannel(channels) {
    if (!process.stdin.isTTY) {
        const first = channels[0];
        if (first) {
            return first;
        }
        return null;
    }
    if (channels.length === 0) {
        stdout.write('未配置任何 namedChannels。请在 config.json 的 channels.yzj.namedChannels 中配置。\n');
        return null;
    }
    if (channels.length === 1) {
        return channels[0];
    }
    return new Promise((resolve) => {
        let selectedIdx = 0;
        let resolved = false;
        const renderMenu = () => {
            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i];
                const prefix = i === selectedIdx ? boldCyan('▶ ') : '  ';
                const label = i === selectedIdx ? boldCyan(ch.name) : ch.name;
                stdout.write(`${prefix}${label} ${dim(`(${ch.robotId})`)}\n`);
            }
            stdout.write(`\x1b[${channels.length}A`);
        };
        const clearMenu = () => {
            stdout.write('\x1b7');
            for (let i = 0; i < channels.length; i++) {
                stdout.write('\n\x1b[2K');
            }
            stdout.write('\x1b8');
        };
        const done = (result) => {
            if (resolved)
                return;
            resolved = true;
            clearMenu();
            stdin.removeListener('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\n');
            resolve(result);
        };
        const onData = (data) => {
            const key = data.toString('utf8');
            if (key === '\x03' || key === '\x1b') {
                done(null);
                return;
            }
            if (key === '\r' || key === '\n') {
                done(channels[selectedIdx]);
                return;
            }
            if (key === '\x1b[A') {
                clearMenu();
                selectedIdx = (selectedIdx - 1 + channels.length) % channels.length;
                renderMenu();
                return;
            }
            if (key === '\x1b[B') {
                clearMenu();
                selectedIdx = (selectedIdx + 1) % channels.length;
                renderMenu();
                return;
            }
        };
        stdout.write('\n选择云之家 channel (↑↓ 选择, Enter 确认, Esc 取消):\n');
        renderMenu();
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}
