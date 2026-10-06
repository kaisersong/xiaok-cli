import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
import type { Config } from '../types.js';
import { getProviderProfile } from '../ai/providers/registry.js';
import { getDefaultModelReasoningEffort, getSupportedModelReasoningEfforts } from '../ai/providers/model-reasoning-effort.js';
import { resolveProviderTransport } from '../ai/providers/auth-resolver.js';
import type { ModelReasoningEffort } from '../ai/providers/types.js';
import type { ReplRenderer } from './repl-renderer.js';

interface ModelOption {
  id: string;
  provider: string;
  model: string;
  label: string;
  desc: string;
}

interface ModelSelectorOptions {
  renderer?: ReplRenderer;
}

type SelectedModel = { modelId: string; provider: string; model: string; label: string; reasoningEffort?: ModelReasoningEffort };

function availableEfforts(config: Config, option: ModelOption): ModelReasoningEffort[] {
  const provider = config.providers[option.provider];
  if (!provider) return [];
  return getSupportedModelReasoningEfforts({ providerId: option.provider, providerType: provider.type,
    protocol: provider.protocol, wireModel: option.model, baseUrl: resolveProviderTransport(config, option.provider).baseUrl });
}

export function buildModelOptions(config: Config): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];

  // 1. 已配置的模型（来自 config.models）
  for (const [id, modelEntry] of Object.entries(config.models)) {
    const providerConfig = config.providers[modelEntry.provider];
    const providerProfile = getProviderProfile(modelEntry.provider);
    const providerLabel = providerProfile?.label ?? modelEntry.provider;
    const providerDesc = providerConfig?.type === 'custom'
      ? `Custom (${providerConfig.baseUrl ?? 'no baseUrl'})`
      : providerLabel;

    seen.add(id);
    result.push({
      id,
      provider: modelEntry.provider,
      model: modelEntry.model,
      label: modelEntry.label,
      desc: providerDesc,
    });
  }

  // 2. Provider 目录中尚未配置的模型变体（对齐 Claude Code getModelOptions 模式）
  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.type !== 'first_party') continue;
    const profile = getProviderProfile(providerId);
    if (!profile?.availableModels) continue;

    const providerLabel = profile.label;
    for (const variant of profile.availableModels) {
      if (seen.has(variant.modelId)) continue;
      seen.add(variant.modelId);
      result.push({
        id: variant.modelId,
        provider: providerId,
        model: variant.model,
        label: variant.label,
        desc: providerLabel,
      });
    }
  }

  // Stable grouping keeps configured models before catalog variants within each provider.
  return result.sort((a, b) => a.provider.localeCompare(b.provider, 'en'));
}

function formatModelSelectorLines(
  models: ModelOption[], selectedIdx: number,
  efforts: Map<string, ModelReasoningEffort>,
): string[] {
  const lines = ['选择模型（强度仅在当前模型内比较）'];

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i]!;
    const selected = i === selectedIdx;
    const prefix = selected ? boldCyan('❯') : ' ';
    const modelStr = selected
      ? boldCyan(`[${model.provider}] ${model.label}`)
      : dim(`[${model.provider}] ${model.label}`);
    const effort = efforts.get(model.id);
    lines.push(`  ${prefix} ${modelStr} - ${dim(model.desc)}${effort ? `  ${selected ? boldCyan(`← ${effort.toUpperCase()} →`) : dim(effort.toUpperCase())}` : ''}`);
  }

  lines.push(dim('↑↓ 选择  ←→ 强度  Enter 确认  Esc 取消'));
  return lines;
}

export async function selectModel(
  config: Config,
  options: ModelSelectorOptions = {},
): Promise<SelectedModel | null> {
  const models = buildModelOptions(config);

  if (models.length === 0) {
    stdout.write('未配置任何模型。请先运行 xiaok config set 配置模型。\n');
    return null;
  }

  const currentModelId = config.defaultModelId;
  let selectedIdx = models.findIndex(m => m.id === currentModelId);
  if (selectedIdx === -1) selectedIdx = 0;
  const effortChoices = new Map(models.map(model => [model.id, availableEfforts(config, model)]));
  const efforts = new Map<string, ModelReasoningEffort>();
  for (const model of models) {
    const choices = effortChoices.get(model.id) ?? [];
    if (choices.length === 0) continue;
    const configured = config.models[model.id]?.runtimeOptions?.reasoningEffort;
    const initial = configured && choices.includes(configured)
      ? configured
      : getDefaultModelReasoningEffort(choices);
    efforts.set(model.id, initial && choices.includes(initial) ? initial : choices[0]!);
  }
  const renderer = options.renderer;
  const useRenderer = Boolean(
    renderer
    && (
      renderer.hasActiveScrollRegion()
      || renderer.getState().prompt !== ''
      || renderer.getState().input.value !== ''
    )
  );

  return new Promise((resolve) => {
    let resolved = false;
    let renderWithRenderer = useRenderer;

    const renderMenu = () => {
      const lines = formatModelSelectorLines(models, selectedIdx, efforts);

      if (renderWithRenderer && renderer) {
        const currentState = renderer.getState();
        renderer.renderInput({
          prompt: currentState.prompt || 'Type your message...',
          input: '',
          cursor: 0,
          footerLines: currentState.footerLines,
          overlayLines: lines,
        });
        return;
      }

      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? boldCyan('❯') : ' ';
        const modelStr = isSelected ? boldCyan(`[${m.provider}] ${m.label}`) : dim(`[${m.provider}] ${m.label}`);
        const descStr = dim(m.desc);
        const effort = efforts.get(m.id);
        stdout.write(`\n  ${prefix} ${modelStr} - ${descStr}${effort ? `  ${effort.toUpperCase()}` : ''}`);
      }
      stdout.write(`\x1b[${models.length}A`);
    };

    const clearMenu = () => {
      if (renderWithRenderer && renderer) {
        renderer.clearOverlay();
        return;
      }
      stdout.write('\x1b7');
      for (let i = 0; i < models.length; i++) {
        stdout.write('\n\x1b[2K');
      }
      stdout.write('\x1b8');
    };

    const done = (result: SelectedModel | null) => {
      if (resolved) return;
      resolved = true;
      clearMenu();
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      if (!renderWithRenderer) {
        stdout.write('\n');
      }
      resolve(result);
    };

    const onData = (data: Buffer) => {
      const key = data.toString('utf8');

      if (key === '\x03' || key === '\x1b') {
        done(null);
        return;
      }

      if (key === '\r' || key === '\n') {
        const selected = models[selectedIdx];
        done({ modelId: selected.id, provider: selected.provider, model: selected.model, label: selected.label,
          ...(efforts.has(selected.id) ? { reasoningEffort: efforts.get(selected.id) } : {}) });
        return;
      }

      if (key === '\x1b[C' || key === '\x1b[D') {
        const selected = models[selectedIdx]!;
        const choices = effortChoices.get(selected.id) ?? [];
        if (choices.length === 0) return;
        const current = choices.indexOf(efforts.get(selected.id)!);
        const direction = key === '\x1b[C' ? 1 : -1;
        efforts.set(selected.id, choices[(current + direction + choices.length) % choices.length]!);
        clearMenu();
        renderMenu();
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

    if (!renderWithRenderer) {
      stdout.write('\n选择模型 (↑↓ 选择, ←→ 强度, Enter 确认, Esc 取消):\n');
    }
    renderMenu();
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
