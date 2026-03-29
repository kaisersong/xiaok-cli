import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
export async function selectModel(config) {
    const models = [];
    if (config.models.claude?.model) {
        models.push({
            provider: 'claude',
            model: config.models.claude.model,
            desc: 'Claude'
        });
    }
    if (config.models.openai?.model) {
        models.push({
            provider: 'openai',
            model: config.models.openai.model,
            desc: 'OpenAI'
        });
    }
    if (config.models.custom?.model && config.models.custom?.baseUrl) {
        models.push({
            provider: 'custom',
            model: config.models.custom.model,
            desc: `Custom (${config.models.custom.baseUrl})`
        });
    }
    if (models.length === 0) {
        stdout.write('未配置任何模型。请先运行 xiaok config set 配置模型。\n');
        return null;
    }
    const currentProvider = config.defaultModel ?? 'claude';
    let selectedIdx = models.findIndex(m => m.provider === currentProvider);
    if (selectedIdx === -1)
        selectedIdx = 0;
    return new Promise((resolve) => {
        let resolved = false;
        const renderMenu = () => {
            for (let i = 0; i < models.length; i++) {
                const m = models[i];
                const isSelected = i === selectedIdx;
                const prefix = isSelected ? boldCyan('❯') : ' ';
                const modelStr = isSelected ? boldCyan(`[${m.provider}] ${m.model}`) : dim(`[${m.provider}] ${m.model}`);
                const descStr = dim(m.desc);
                stdout.write(`\n  ${prefix} ${modelStr} - ${descStr}`);
            }
            stdout.write(`\x1b[${models.length}A`);
        };
        const clearMenu = () => {
            stdout.write('\x1b7');
            for (let i = 0; i < models.length; i++) {
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
                const selected = models[selectedIdx];
                done({ provider: selected.provider, model: selected.model });
                return;
            }
            if (key === '\x1b[A') {
                clearMenu();
                selectedIdx = (selectedIdx - 1 + models.length) % models.length;
                renderMenu();
                return;
            }
            if (key === '\x1b[B') {
                clearMenu();
                selectedIdx = (selectedIdx + 1) % models.length;
                renderMenu();
                return;
            }
        };
        stdout.write('\n选择模型 (↑↓ 选择, Enter 确认, Esc 取消):\n');
        renderMenu();
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}
