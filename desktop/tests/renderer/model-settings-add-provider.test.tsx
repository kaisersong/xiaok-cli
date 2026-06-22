import React from 'react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    { id: 'kimi', label: 'Kimi', protocol: 'openai_legacy', baseUrl: 'https://api.kimi.com/coding/v1', defaultModelId: 'kimi-default', defaultModel: 'kimi-for-coding', defaultModelLabel: 'Kimi for Coding', capabilities: ['tools', 'thinking'], availableModels: [{ modelId: 'kimi-for-coding', model: 'kimi-for-coding', label: 'Kimi for Coding', capabilities: ['tools', 'thinking'] }, { modelId: 'kimi-k2', model: 'k2-0507-preview', label: 'Kimi K2', capabilities: ['tools', 'thinking'] }] },
    { id: 'deepseek', label: 'DeepSeek', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com/v1', defaultModelId: 'deepseek-default', defaultModel: 'deepseek-v4-pro', defaultModelLabel: 'DeepSeek V4 Pro', capabilities: ['tools'], availableModels: [{ modelId: 'deepseek-v4-pro', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['tools'] }] },
    { id: 'glm', label: 'GLM', protocol: 'openai_legacy', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModelId: 'glm-default', defaultModel: 'glm-4.5', defaultModelLabel: 'GLM 4.5', capabilities: ['tools'], availableModels: [{ modelId: 'glm-4.5', model: 'glm-4.5', label: 'GLM 4.5', capabilities: ['tools'] }] },
    { id: 'minimax', label: 'MiniMax', protocol: 'openai_legacy', baseUrl: 'https://api.minimax.chat/v1', defaultModelId: 'minimax-default', defaultModel: 'MiniMax-Text-01', defaultModelLabel: 'MiniMax Text 01', capabilities: ['tools'], availableModels: [{ modelId: 'minimax-text-01', model: 'MiniMax-Text-01', label: 'MiniMax Text 01', capabilities: ['tools'] }] },
    { id: 'gemini', label: 'Gemini', protocol: 'openai_responses', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModelId: 'gemini-default', defaultModel: 'gemini-2.5-pro', defaultModelLabel: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'], availableModels: [{ modelId: 'gemini-2.5-pro', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'] }] },
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
    expect(screen.getByText('Kimi for Coding')).toBeInTheDocument()
    expect(screen.getByText('Kimi K2')).toBeInTheDocument()

    // Should show default model hint
    expect(screen.getByText(/添加后默认模型: Kimi for Coding/)).toBeInTheDocument()

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
