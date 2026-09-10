import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUpdateAgent = vi.fn().mockResolvedValue(true);

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ updateAgent: mockUpdateAgent }),
}));

vi.mock('../../renderer/src/api', () => ({api: {getModelConfig: async () => ({defaultModelId: 'text', models: [{id:'vision', label:'Vision', capabilities:['image_in']} ]})}}));

import { EditAgentModal } from '../../renderer/src/components/projects/EditAgentModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOCK_AGENT = {
  id: 'agent-001',
  name: 'Kimi Agent',
  roles: ['worker'],
  runtimeType: 'kimi',
  provider: 'openai',
  model: 'gpt-4o',
  baseUrl: 'https://example.invalid/v1',
  instructions: 'Write clearly',
  status: 'idle' as const,
};

function renderModal(agent = MOCK_AGENT) {
  return render(
    <LocaleProvider>
      <EditAgentModal agent={agent as any} onClose={() => {}} />
    </LocaleProvider>
  );
}

describe('EditAgentModal: native CLI runtime owns its provider configuration', () => {
  it('shows the immutable runtime and removes ineffective provider credentials', () => {
    renderModal();

    expect(screen.getByDisplayValue('Kimi')).toBeDisabled();
    expect(screen.getByText('使用 Kimi 自身的登录、模型与提供商配置。')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('baseurl-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('apikey-input')).not.toBeInTheDocument();
  });

  it('only sends editable semantic fields on save', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Kimi Writer' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-001', {
        name: 'Kimi Writer',
        instructions: 'Write clearly',
        fallbackToDesktopModel: false,
      });
    });
  });
});

describe('EditAgentModal: local Xiaok configured model', () => {
  it('saves an explicit model reference and can reset it to follow current', async () => {
    renderModal({...MOCK_AGENT,runtimeType:'xiaok'});
    fireEvent.click(screen.getByLabelText('模型'));
    fireEvent.click(await screen.findByRole('button',{name:/Vision/}));
    fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
    await waitFor(()=>expect(mockUpdateAgent).toHaveBeenCalledWith('agent-001',expect.objectContaining({desktopModelId:'vision'})));
    cleanup();mockUpdateAgent.mockClear();
    renderModal({...MOCK_AGENT,runtimeType:'xiaok',desktopModelId:'vision'} as any);
    fireEvent.click(screen.getByLabelText('模型'));
    fireEvent.click(await screen.findByRole('button',{name:/跟随小 K 当前模型/}));
    fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
    await waitFor(()=>expect(mockUpdateAgent).toHaveBeenCalledWith('agent-001',expect.objectContaining({desktopModelId:null})));
  });
});
