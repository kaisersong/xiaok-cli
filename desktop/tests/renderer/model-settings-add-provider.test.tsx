import React from 'react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Use real LocaleProvider instead of mocking useLocale
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext'

vi.mock('../../renderer/src/themes/presets', () => ({
  BUILTIN_PRESETS: {},
}))

vi.mock('../../renderer/src/themes/types', () => ({
  COLOR_GROUPS: [],
}))

vi.mock('../../renderer/src/contexts/AppearanceContext', () => ({
  useAppearance: () => ({
    fontFamily: 'default',
    codeFontFamily: 'jetbrains-mono',
    fontSize: 'normal',
    themePreset: 'default',
    customThemeId: null,
    customThemes: {},
    setFontFamily: () => {},
    setCodeFontFamily: () => {},
    setFontSize: () => {},
    setThemePreset: () => {},
    setActiveCustomTheme: () => {},
    saveCustomTheme: () => {},
    deleteCustomTheme: () => {},
    setPreviewVars: () => {},
    setCustomBodyFont: () => {},
    customBodyFont: null,
    activeThemeVars: { dark: {}, light: {} },
  }),
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock LocalMemoryStats
vi.mock('../../renderer/src/components/LocalMemoryStats', () => ({
  LocalMemoryStats: () => <div data-testid="local-memory-stats" />,
}))

// Build a fake model config snapshot
const KIMI_K3_RUNTIME_OPTIONS = {
  contextLimit: 262_144,
  reasoningEffort: 'high',
} as const

const KIMI_K3_RUNTIME_CONSTRAINTS = {
  maxContextLimit: 1_048_576,
  reasoningEfforts: ['low', 'high', 'max'],
} as const

const MOCK_SNAPSHOT = {
  configPath: '/tmp/config.json',
  defaultProvider: 'anthropic',
  defaultModelId: 'anthropic-default',
  providers: [
    { id: 'anthropic', label: 'Anthropic', type: 'first_party', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKeyConfigured: true },
  ],
  models: [
    { id: 'anthropic-default', provider: 'anthropic', model: 'claude-opus-4-6', label: 'Claude Opus 4.6', capabilities: ['tools'], isDefault: true },
    { id: 'anthropic-sonnet', provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', capabilities: ['tools'], isDefault: false },
  ],
  providerProfiles: [
    { id: 'openai', label: 'OpenAI', protocol: 'openai_legacy', baseUrl: 'https://api.openai.com/v1', defaultModelId: 'openai-default', defaultModel: 'gpt-4o', defaultModelLabel: 'GPT-4o', capabilities: ['tools'], availableModels: [{ modelId: 'openai-gpt-4o', model: 'gpt-4o', label: 'GPT-4o', capabilities: ['tools'] }, { modelId: 'openai-gpt-4.1', model: 'gpt-4.1', label: 'GPT-4.1', capabilities: ['tools'] }] },
    { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModelId: 'anthropic-default', defaultModel: 'claude-opus-4-6', defaultModelLabel: 'Claude Opus 4.6', capabilities: ['tools'], availableModels: [{ modelId: 'anthropic-claude-opus-4-6', model: 'claude-opus-4-6', label: 'Claude Opus 4.6', capabilities: ['tools'] }] },
    { id: 'kimi', label: 'Kimi', protocol: 'openai_legacy', baseUrl: 'https://api.kimi.com/coding/v1', defaultModelId: 'kimi-default', defaultModel: 'k3', defaultModelLabel: 'Kimi K3', capabilities: ['tools', 'thinking'], availableModels: [{ modelId: 'kimi-k3', model: 'k3', label: 'Kimi K3', capabilities: ['tools', 'thinking'], runtimeOptions: KIMI_K3_RUNTIME_OPTIONS, runtimeConstraints: KIMI_K3_RUNTIME_CONSTRAINTS }, { modelId: 'kimi-k2.7', model: 'kimi-k2.7', label: 'Kimi K2.7', capabilities: ['tools', 'thinking'] }] },
    { id: 'deepseek', label: 'DeepSeek', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com/v1', defaultModelId: 'deepseek-default', defaultModel: 'deepseek-v4-pro', defaultModelLabel: 'DeepSeek V4 Pro', capabilities: ['tools'], availableModels: [{ modelId: 'deepseek-v4-pro', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['tools'] }] },
    { id: 'glm', label: 'GLM', protocol: 'openai_legacy', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModelId: 'glm-default', defaultModel: 'glm-4.5', defaultModelLabel: 'GLM 4.5', capabilities: ['tools'], availableModels: [{ modelId: 'glm-4.5', model: 'glm-4.5', label: 'GLM 4.5', capabilities: ['tools'] }] },
    { id: 'minimax', label: 'MiniMax', protocol: 'openai_legacy', baseUrl: 'https://api.minimax.chat/v1', defaultModelId: 'minimax-default', defaultModel: 'MiniMax-Text-01', defaultModelLabel: 'MiniMax Text 01', capabilities: ['tools'], availableModels: [{ modelId: 'minimax-text-01', model: 'MiniMax-Text-01', label: 'MiniMax Text 01', capabilities: ['tools'] }] },
    { id: 'gemini', label: 'Gemini', protocol: 'openai_responses', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModelId: 'gemini-default', defaultModel: 'gemini-2.5-pro', defaultModelLabel: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'], availableModels: [{ modelId: 'gemini-2.5-pro', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'] }] },
  ],
}

const SNAPSHOT_WITH_KIMI_MODEL = {
  ...MOCK_SNAPSHOT,
  providers: [
    ...MOCK_SNAPSHOT.providers,
    { id: 'kimi', label: 'Kimi', type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.kimi.com/coding/v1', apiKeyConfigured: true },
  ],
  models: [
    ...MOCK_SNAPSHOT.models,
    {
      id: 'kimi-default',
      provider: 'kimi',
      model: 'k3',
      label: 'Kimi K3',
      capabilities: ['tools', 'thinking'],
      runtimeOptions: KIMI_K3_RUNTIME_OPTIONS,
      runtimeConstraints: KIMI_K3_RUNTIME_CONSTRAINTS,
      isDefault: false,
    },
  ],
}

const KIMI_K3_SNAPSHOT = {
  ...SNAPSHOT_WITH_KIMI_MODEL,
  defaultProvider: 'kimi',
  defaultModelId: 'kimi-default',
  models: SNAPSHOT_WITH_KIMI_MODEL.models.map(model => ({
    ...model,
    isDefault: model.id === 'kimi-default',
  })),
}

const KIMI_K27_SNAPSHOT = {
  ...SNAPSHOT_WITH_KIMI_MODEL,
  defaultProvider: 'kimi',
  defaultModelId: 'kimi-k2.7',
  models: [
    ...MOCK_SNAPSHOT.models.map(model => ({ ...model, isDefault: false })),
    {
      id: 'kimi-k2.7',
      provider: 'kimi',
      model: 'kimi-k2.7',
      label: 'Kimi K2.7',
      capabilities: ['tools', 'thinking'],
      isDefault: true,
    },
  ],
}

vi.mock('../../renderer/src/api', () => {
  const handler: ProxyHandler<Record<string, any>> = {
    get(target, prop) {
      if (typeof prop === 'string' && !target[prop]) {
        target[prop] = vi.fn().mockResolvedValue(undefined)
      }
      return target[prop]
    },
  }
  return { api: new Proxy({}, handler) }
})

// Import after mocks
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings'
import { api } from '../../renderer/src/api'

function renderSettings() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <DesktopSettings onClose={vi.fn()} />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(api.getModelConfig).mockResolvedValue(MOCK_SNAPSHOT as any)
  vi.mocked(api.saveModelConfig).mockResolvedValue(MOCK_SNAPSHOT as any)
  vi.mocked(api.updateModelRuntimeOptions).mockResolvedValue(MOCK_SNAPSHOT as any)
  vi.mocked(api.testProviderConnection).mockResolvedValue({ success: true, latencyMs: 100 })
  vi.mocked(api.listAvailableModelsForProvider).mockResolvedValue([])
  vi.mocked(api.deleteProvider).mockResolvedValue(undefined)
  vi.mocked(api.deleteModel).mockResolvedValue(undefined)
  // Other panes call these on mount
  vi.mocked(api.getSkillDebugConfig).mockResolvedValue({ enabled: false })
  vi.mocked(api.getKswarmConfig).mockResolvedValue({ maxConcurrentTasks: 3 })
  vi.mocked(api.saveKswarmConfig).mockResolvedValue({ maxConcurrentTasks: 3 })
  vi.mocked(api.listSkills).mockResolvedValue([])
  vi.mocked(api.listChannels).mockResolvedValue([])
  vi.mocked(api.listMCPInstalls).mockResolvedValue([])
  vi.mocked(api.listPluginMcpServers).mockResolvedValue([])
  vi.mocked(api.listAvailablePlugins).mockResolvedValue([])
  vi.mocked(api.getSkillStats).mockResolvedValue({})
  vi.mocked(api.getUpdateStatus).mockResolvedValue({ state: 'idle' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Model Settings — Add Provider', () => {
  it('shows the current default model and lets the user switch it', async () => {
    const switchedSnapshot = {
      ...MOCK_SNAPSHOT,
      defaultModelId: 'anthropic-sonnet',
      models: MOCK_SNAPSHOT.models.map(m => ({ ...m, isDefault: m.id === 'anthropic-sonnet' })),
    }
    vi.mocked(api.saveModelConfig).mockResolvedValueOnce(switchedSnapshot as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('当前使用模型')).toBeInTheDocument()
      expect(screen.getAllByText('Claude Opus 4.6').length).toBeGreaterThan(0)
    })

    const sonnetRow = screen.getByText('Claude Sonnet 4.6').closest('span')!
    fireEvent.click(within(sonnetRow).getByRole('button', { name: '设为默认' }))

    await waitFor(() => {
      expect(api.saveModelConfig).toHaveBeenCalledWith({
        providerId: 'anthropic',
        modelId: 'anthropic-sonnet',
      })
    })
    expect(screen.getByText('当前模型已切换为 Claude Sonnet 4.6')).toBeInTheDocument()
    expect(screen.queryByText(/Kimi 缓存将失效/)).not.toBeInTheDocument()
  })

  it('appends the new-session guidance when switching the current model to Kimi K3', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(SNAPSHOT_WITH_KIMI_MODEL as any)
    vi.mocked(api.saveModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const kimiRow = (await screen.findByText('Kimi K3')).closest('span')!
    fireEvent.click(within(kimiRow).getByRole('button', { name: '设为默认' }))

    await waitFor(() => {
      expect(screen.getByText(/当前模型已切换为 Kimi K3.*Kimi 缓存将失效.*新建会话/)).toBeInTheDocument()
    })
  })

  it('shows constraint-driven Kimi K3 runtime controls with no off option', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const contextSelect = await screen.findByRole('combobox', { name: '上下文窗口' })
    const effortSelect = screen.getByRole('combobox', { name: '推理强度' })

    expect(contextSelect).toHaveValue('262144')
    expect(effortSelect).toHaveValue('high')
    expect(within(contextSelect).getAllByRole('option').map(option => option.textContent)).toEqual(['262K', '1M'])
    expect(within(effortSelect).getAllByRole('option').map(option => option.textContent)).toEqual(['Low', 'High', 'Max'])
    expect(`${contextSelect.textContent} ${effortSelect.textContent}`).not.toMatch(/none|off|关闭|无/i)
    expect(screen.getByText(/Allegretto.*更高计划/)).toBeInTheDocument()
  })

  it('preserves a Kimi K3 connection diagnostic and appends localized permission guidance', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)
    vi.mocked(api.testProviderConnection).mockResolvedValueOnce({
      success: false,
      error: 'HTTP 401: model access denied',
    })

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const testButtons = await screen.findAllByRole('button', { name: '测试连接' })
    fireEvent.click(testButtons[1])

    expect(await screen.findByText(/HTTP 401: model access denied.*Kimi Code API Key.*1M.*262K.*Allegretto/)).toBeInTheDocument()
    expect(api.testProviderConnection).toHaveBeenCalledWith({ providerId: 'kimi' })
  })

  it('does not append Kimi K3 permission guidance to a non-K3 connection failure', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K27_SNAPSHOT as any)
    vi.mocked(api.testProviderConnection).mockResolvedValueOnce({
      success: false,
      error: 'HTTP 401: legacy model denied',
    })

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const testButtons = await screen.findAllByRole('button', { name: '测试连接' })
    fireEvent.click(testButtons[1])

    expect((await screen.findAllByText('HTTP 401: legacy model denied')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Kimi Code API Key.*K3 权限/)).not.toBeInTheDocument()
  })

  it('saves 1M and Max for the exact model and refreshes from the returned snapshot', async () => {
    const updatedSnapshot = {
      ...KIMI_K3_SNAPSHOT,
      models: KIMI_K3_SNAPSHOT.models.map(model => model.id === 'kimi-default'
        ? {
            ...model,
            runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'low' as const },
          }
        : model),
    }
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)
    vi.mocked(api.updateModelRuntimeOptions).mockResolvedValueOnce(updatedSnapshot as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const contextSelect = await screen.findByRole('combobox', { name: '上下文窗口' })
    const effortSelect = screen.getByRole('combobox', { name: '推理强度' })
    fireEvent.change(contextSelect, { target: { value: '1048576' } })
    fireEvent.change(effortSelect, { target: { value: 'max' } })
    fireEvent.click(screen.getByRole('button', { name: '保存运行参数' }))

    await waitFor(() => {
      expect(api.updateModelRuntimeOptions).toHaveBeenCalledWith({
        modelId: 'kimi-default',
        runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
      })
    })
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '上下文窗口' })).toHaveValue('262144')
      expect(screen.getByRole('combobox', { name: '推理强度' })).toHaveValue('low')
      expect(screen.getByText(/Kimi K3 运行参数已保存.*Kimi 缓存将失效.*新建会话/)).toBeInTheDocument()
    })
    expect(api.getModelConfig).toHaveBeenCalledTimes(1)
  })

  it('blocks another model mutation while runtime options are being saved', async () => {
    let resolveUpdate!: (snapshot: typeof KIMI_K3_SNAPSHOT) => void
    const updatePromise = new Promise<typeof KIMI_K3_SNAPSHOT>(resolve => {
      resolveUpdate = resolve
    })
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)
    vi.mocked(api.updateModelRuntimeOptions).mockReturnValueOnce(updatePromise as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const runtimeSave = await screen.findByRole('button', { name: '保存运行参数' })
    fireEvent.click(runtimeSave)

    await waitFor(() => expect(runtimeSave).toBeDisabled())
    const sonnetRow = screen.getByText('Claude Sonnet 4.6').closest('span')!
    const switchButton = within(sonnetRow).getByRole('button', { name: '设为默认' })
    expect(switchButton).toBeDisabled()
    fireEvent.click(switchButton)
    expect(api.saveModelConfig).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate(KIMI_K3_SNAPSHOT)
      await updatePromise
    })
    await waitFor(() => expect(runtimeSave).toBeEnabled())
  })

  it('restores the runtime editor after a save error without showing success', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(KIMI_K3_SNAPSHOT as any)
    vi.mocked(api.updateModelRuntimeOptions).mockRejectedValueOnce(new Error('runtime save failed'))

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    const runtimeSave = await screen.findByRole('button', { name: '保存运行参数' })
    fireEvent.click(runtimeSave)

    expect(await screen.findByText('runtime save failed')).toBeInTheDocument()
    expect(screen.queryByText(/Kimi K3 运行参数已保存/)).not.toBeInTheDocument()
    expect(runtimeSave).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '上下文窗口' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '推理强度' })).toBeEnabled()
  })

  it.each([
    ['Anthropic', MOCK_SNAPSHOT],
    ['Kimi K2.7', KIMI_K27_SNAPSHOT],
    ['Kimi K3 without complete constraints', {
      ...KIMI_K3_SNAPSHOT,
      models: KIMI_K3_SNAPSHOT.models.map(model => model.id === 'kimi-default'
        ? {
            ...model,
            runtimeConstraints: { maxContextLimit: 1_048_576, reasoningEfforts: ['low', 'high'] },
          }
        : model),
    }],
  ])('does not show Kimi K3 runtime controls for %s', async (_label, snapshot) => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce(snapshot as any)

    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await screen.findByText('当前使用模型')
    expect(screen.queryByRole('combobox', { name: '上下文窗口' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '推理强度' })).not.toBeInTheDocument()
  })

  it('shows provider selection dropdown with unconfigured providers', async () => {
    renderSettings()

    // Navigate to model tab
    fireEvent.click(screen.getByText('模型设置'))

    // Wait for config to load
    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    // Find the add-provider dropdown (the one with "选择提供商" option)
    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )

    // The dropdown should exist and list unconfigured providers
    expect(addProviderSelect).toBeDefined()
    const options = Array.from(addProviderSelect!.querySelectorAll('option')).map(o => o.textContent)
    expect(options.length).toBeGreaterThan(2) // placeholder + at least one provider + custom
  })

  it('dropdown shows all providers, marking configured ones', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    // Find all select elements and look for the one with "选择提供商"
    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )
    expect(addProviderSelect).toBeDefined()

    const options = Array.from(addProviderSelect!.querySelectorAll('option')).map(o => o.textContent)
    // All providers should be listed
    expect(options).toContain('OpenAI')
    expect(options).toContain('Kimi')
    expect(options).toContain('DeepSeek')
    expect(options).toContain('GLM')
    expect(options).toContain('MiniMax')
    expect(options).toContain('Gemini')
    // Anthropic is configured, should show with "(已配置)" suffix
    expect(options).toContain('Anthropic (已配置)')
    // Custom option
    expect(options).toContain('自定义 (OpenAI 兼容)')
  })

  it('shows base URL and available models when provider is selected', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )!

    // Select Kimi
    fireEvent.change(addProviderSelect, { target: { value: 'kimi' } })

    // Should show base URL (pre-filled, editable)
    await waitFor(() => {
      const baseUrlInput = screen.getByDisplayValue('https://api.kimi.com/coding/v1')
      expect(baseUrlInput).toBeInTheDocument()
      expect(baseUrlInput).not.toHaveAttribute('readonly')
    })

    // Should show available models
    expect(screen.getByText('Kimi K3')).toBeInTheDocument()
    expect(screen.getByText('Kimi K2.7')).toBeInTheDocument()

    // Should show default model hint
    expect(screen.getByText(/添加后默认模型: Kimi K3/)).toBeInTheDocument()

    // Should show protocol info
    expect(screen.getByText(/openai_legacy/)).toBeInTheDocument()
  })

  it('shows DeepSeek base URL when selected', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )!

    fireEvent.change(addProviderSelect, { target: { value: 'deepseek' } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument()
    })
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument()
  })

  it('custom provider shows editable base URL field', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )!

    fireEvent.change(addProviderSelect, { target: { value: '__custom__' } })

    // Should show provider name input
    await waitFor(() => {
      expect(screen.getByPlaceholderText('my-provider')).toBeInTheDocument()
    })

    // Base URL should be editable (not readonly)
    const baseUrlInput = screen.getByPlaceholderText('https://api.example.com/v1')
    expect(baseUrlInput).toBeInTheDocument()
    expect(baseUrlInput).not.toHaveAttribute('readonly')
  })

  it('calls saveModelConfig with correct params on add', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('模型设置'))

    await waitFor(() => {
      expect(screen.getByText('添加模型提供商')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const addProviderSelect = selects.find(el =>
      Array.from(el.querySelectorAll('option')).some(o => o.textContent === '— 选择提供商 —')
    )!

    // Select DeepSeek
    fireEvent.change(addProviderSelect, { target: { value: 'deepseek' } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument()
    })

    // Enter API key — now only one 'sk-...' input exists (in AddProviderCard)
    const keyInput = screen.getByPlaceholderText('sk-...')
    fireEvent.change(keyInput, { target: { value: 'sk-deepseek-test' } })

    // Click add button
    const addButton = screen.getByText('添加提供商')
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(api.saveModelConfig).toHaveBeenCalledWith({
        providerId: 'deepseek',
        apiKey: 'sk-deepseek-test',
        baseUrl: 'https://api.deepseek.com/v1',
      })
    })
  })
})
