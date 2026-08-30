/**
 * Desktop agent-create contract for Pi / DeepSeek Harness runtimes
 * (design §6 Desktop, §7 test order step 5 of the pi/deepseek harness doc).
 *
 * Invariants:
 *   - create payload carries only runtimeType + display fields; no
 *     provider/apiKey/baseUrl/customEnv/runtimePath from the renderer.
 *   - Pi (supported) is selectable; DeepSeek (detected-but-unsupported)
 *     renders unavailable with the server reasonCode, not a provider form.
 *   - supported native CLI runtimes never show the fixed provider form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateAgentModal } from '../../renderer/src/components/projects/CreateAgentModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const { mockCreateAgent, mockFetchRuntimes } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn().mockResolvedValue({ ok: true }),
  mockFetchRuntimes: vi.fn().mockResolvedValue([
    { type: 'xiaok-cli', displayName: 'xiaok-cli', description: 'xiaok', detected: true, supported: true },
    { type: 'pi', displayName: 'Pi', description: 'Pi Agent CLI', detected: true, supported: true, callability: 'unknown', reasonCode: null },
    { type: 'deepseek', displayName: 'DeepSeek Harness', description: 'dsh', detected: true, supported: false, callability: 'unavailable', reasonCode: 'deepseek_headless_not_verified' },
  ]),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ createAgent: mockCreateAgent, fetchRuntimes: mockFetchRuntimes, connected: true }),
}));
vi.mock('../../renderer/src/hooks/useRuntimes', () => ({
  useRuntimes: () => ({
    data: [
      { type: 'xiaok-cli', displayName: 'xiaok-cli', description: 'xiaok', detected: true, supported: true },
      { type: 'pi', displayName: 'Pi', description: 'Pi Agent CLI', detected: true, supported: true, callability: 'unknown', reasonCode: null },
      { type: 'deepseek', displayName: 'DeepSeek Harness', description: 'dsh', detected: true, supported: false, callability: 'unavailable', reasonCode: 'deepseek_headless_not_verified' },
    ],
    isLoading: false,
  }),
  useInvalidateRuntimes: () => vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal() {
  render(
    <LocaleProvider>
      <CreateAgentModal open onClose={vi.fn()} />
    </LocaleProvider>,
  );
}

/** runtime options live on step 2 — advance past the agent-type step */
function advanceToRuntimeStep() {
  const nextButton = screen.getByText(/下一步|Next/i);
  fireEvent.click(nextButton);
}

describe('pi/deepseek agent create contract', () => {
  it('renders Pi as a selectable supported native CLI runtime', async () => {
    renderModal();
    advanceToRuntimeStep();
    const piOption = await waitFor(() => screen.getByText('Pi'));
    expect(piOption).toBeDefined();
    expect((piOption.closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders DeepSeek Harness as unavailable (detected-but-unsupported)', async () => {
    renderModal();
    advanceToRuntimeStep();
    const deepseekOption = await waitFor(() => screen.getByText('DeepSeek Harness'));
    expect((deepseekOption.closest('button') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => {
      expect(screen.getAllByText(/不支持|not supported/i).length).toBeGreaterThan(0);
    });
  });

  it('create payload carries only semantic fields — no provider secrets or runtimePath', async () => {
    renderModal();
    advanceToRuntimeStep();
    const piOption = await waitFor(() => screen.getByText('Pi'));
    fireEvent.click(piOption);
    const nameInput = await waitFor(() => screen.getByLabelText(/名称|Name/i));
    fireEvent.change(nameInput, { target: { value: 'Pi Worker' } });
    await waitFor(() => {
      expect(screen.getByText(/创建|Create/i).closest('button')?.disabled).toBe(false);
    });
    fireEvent.click(screen.getByText(/创建|Create/i));
    await waitFor(() => expect(mockCreateAgent).toHaveBeenCalled());
    const payload = mockCreateAgent.mock.calls[0]?.[0] ?? {};
    for (const forbidden of ['apiKey', 'provider', 'baseUrl', 'runtimePath', 'customEnv']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });
});
