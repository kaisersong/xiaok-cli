import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnterpriseCliConnectors } from '../../renderer/src/components/settings/EnterpriseCliConnectors';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ getEnterpriseCliConnectors: vi.fn(), controlEnterpriseCliConnector: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => mocks }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const initial = ['dingtalk','feishu','wecom'].map(provider => ({provider,phase:'notInstalled',revision:0,installed:false}));
describe('enterprise CLI connector cards', () => {
 it('shows all three providers without automatically installing or logging in', async () => { mocks.getEnterpriseCliConnectors.mockResolvedValue(initial); render(<LocaleProvider><EnterpriseCliConnectors /></LocaleProvider>); await screen.findByText('钉钉'); expect(screen.getByText('飞书')).toBeInTheDocument(); expect(screen.getByText('企业微信')).toBeInTheDocument(); expect(screen.getAllByRole('button',{name:'下载安装'})).toHaveLength(3); expect(mocks.controlEnterpriseCliConnector).not.toHaveBeenCalled(); });
 it('does not spawn an installed CLI just by opening the page', async () => { mocks.getEnterpriseCliConnectors.mockResolvedValue(initial.map(state=>({...state,installed:true,phase:'ready',version:'1.0.0'}))); render(<LocaleProvider><EnterpriseCliConnectors /></LocaleProvider>); await screen.findByText('钉钉'); expect(mocks.controlEnterpriseCliConnector).not.toHaveBeenCalled(); });
 it('starts the selected installation only after its button is clicked', async () => { mocks.getEnterpriseCliConnectors.mockResolvedValue(initial); mocks.controlEnterpriseCliConnector.mockResolvedValue({...initial[0],phase:'installing',revision:1}); render(<LocaleProvider><EnterpriseCliConnectors /></LocaleProvider>); const buttons = await screen.findAllByRole('button',{name:'下载安装'}); fireEvent.click(buttons[0]); await screen.findByText('正在下载安装…'); expect(mocks.controlEnterpriseCliConnector).toHaveBeenCalledExactlyOnceWith('dingtalk','install'); });
});
