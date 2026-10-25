import { existsSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../../renderer/src/components/shared/Modal';
import { DirectionAwareTabs } from '../../renderer/src/components/ui/direction-aware-tabs';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function switchComponent() {
  const path = process.cwd() + '/renderer/src/components/ui/BooleanSwitch.tsx';
  const modulePath = '../../renderer/src/components/ui/BooleanSwitch';
  const component = existsSync(path) ? (await import(modulePath)).BooleanSwitch : undefined;
  expect(component).toBeTypeOf('function'); return component!;
}
async function externalHelper() {
  const path = process.cwd() + '/renderer/src/openExternal.ts';
  const modulePath = '../../renderer/src/openExternal';
  const helper = existsSync(path) ? await import(modulePath) : undefined;
  expect(helper?.openExternal).toBeTypeOf('function'); expect(helper?.handleExternalAnchorClick).toBeTypeOf('function'); return helper!;
}
it('real boolean switch exposes checked state and a single boolean callback', async () => {
  const Switch = await switchComponent(), change = vi.fn(); render(<Switch checked ariaLabel="owned localized label" onChange={change} />);
  const button = screen.getByRole('switch', { name: 'owned localized label' }); expect(button).toHaveAttribute('aria-checked', 'true'); fireEvent.click(button); expect(change).toHaveBeenCalledExactlyOnceWith(false);
});
it('real disabled boolean switch never invokes the original callback', async () => {
  const Switch = await switchComponent(), change = vi.fn(); render(<Switch checked={false} disabled ariaLabel="owned localized label" onChange={change} />); fireEvent.click(screen.getByRole('switch')); expect(change).not.toHaveBeenCalled();
});
it('existing real Modal stays closed and its real close callback remains usable', () => {
  const close = vi.fn(), view = render(<Modal open={false} onClose={close} title="owned-modal">owned-body</Modal>); expect(screen.queryByText('owned-body')).toBeNull();
  view.rerender(<Modal open onClose={close} title="owned-modal">owned-body</Modal>); expect(screen.getByText('owned-body')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Close modal' })); expect(close).toHaveBeenCalledTimes(1);
});
it('existing real tabs leave active tab untouched and route another tab once', () => {
  const change = vi.fn(); render(<DirectionAwareTabs tabs={[{ id: 'installed', label: 'owned installed' }, { id: 'builtin', label: 'owned builtin' }]} activeId="installed" onChange={change} layoutId="owned-prerequisite-tabs" />);
  fireEvent.click(screen.getByRole('tab', { name: 'owned installed' })); expect(change).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('tab', { name: 'owned builtin' })); expect(change).toHaveBeenCalledExactlyOnceWith('builtin');
});
it.each(['https://owned.invalid/path', 'http://owned.invalid/path'])('HTTP helper requests only one renderer window for %s, without an OS completion claim', async url => {
  const helper = await externalHelper(), open = vi.spyOn(window, 'open').mockReturnValue(null); helper.openExternal(url); expect(open).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'noopener,noreferrer');
});
it.each(['javascript:owned', 'file:///owned', 'data:text/plain,owned', 'not-a-url'])('HTTP helper refuses invalid/nonHTTP %s without a window call', async url => {
  const helper = await externalHelper(), open = vi.spyOn(window, 'open').mockReturnValue(null); helper.openExternal(url); expect(open).not.toHaveBeenCalled();
});
it('plain primary anchors always prevent default and only delegate a valid URL', async () => {
  const helper = await externalHelper(), open = vi.spyOn(window, 'open').mockReturnValue(null), preventDefault = vi.fn(); helper.handleExternalAnchorClick({ button: 0, preventDefault }, 'javascript:owned'); expect(preventDefault).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
  helper.handleExternalAnchorClick({ button: 0, preventDefault }, 'https://owned.invalid/path'); expect(preventDefault).toHaveBeenCalledTimes(2); expect(open).toHaveBeenCalledTimes(1);
});
it.each([{ button: 1 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true }, { button: 0, shiftKey: true }, { button: 0, altKey: true }, { button: 0, defaultPrevented: true }])('preserves modified/non-primary/defaultPrevented anchor behavior %s', async fields => {
  const helper = await externalHelper(), open = vi.spyOn(window, 'open').mockReturnValue(null), preventDefault = vi.fn(); helper.handleExternalAnchorClick({ ...fields, preventDefault }, 'https://owned.invalid/path'); expect(preventDefault).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
