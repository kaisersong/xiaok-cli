import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
import { getProviderProfile } from '../ai/providers/registry.js';
export function buildModelOptions(config) {
    return Object.entries(config.models).map(([id, modelEntry]) => {
        const providerConfig = config.providers[modelEntry.provider];
        const providerProfile = getProviderProfile(modelEntry.provider);
        const providerLabel = providerProfile?.label ?? modelEntry.provider;
        const providerDesc = providerConfig?.type === 'custom'
            ? `Custom (${providerConfig.baseUrl ?? 'no baseUrl'})`
            : providerLabel;
        return {
            id,
            provider: modelEntry.provider,
            model: modelEntry.model,
            label: modelEntry.label,
            desc: providerDesc,
        };
    });
}
export async function selectModel(config) {
    const models = buildModelOptions(config);
    if (models.length === 0) {
        stdout.write('未配置任何模型。请先运行 xiaok config set 配置模型。\n');
        return null;
    }
    const currentModelId = config.defaultModelId;
    let selectedIdx = models.findIndex(m => m.id === currentModelId);
    if (selectedIdx === -1)
        selectedIdx = 0;
    return new Promise((resolve) => {
        let resolved = false;
        const renderMenu = () => {
            for (let i = 0; i < models.length; i++) {
                const m = models[i];
                const isSelected = i === selectedIdx;
                const prefix = isSelected ? boldCyan('❯') : ' ';
                const modelStr = isSelected ? boldCyan(`[${m.provider}] ${m.label}`) : dim(`[${m.provider}] ${m.label}`);
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
                done({ modelId: selected.id, provider: selected.provider, model: selected.model, label: selected.label });
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
