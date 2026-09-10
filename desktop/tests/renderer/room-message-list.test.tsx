import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomMessageList } from '../../renderer/src/components/collaboration/RoomMessageList';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('starts at latest, preserves scrollback, and resumes following after jumping down', () => {
  let height = 1200;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const view = (revision: number) => <LocaleProvider><RoomMessageList revision={revision}><div>messages {revision}</div></RoomMessageList></LocaleProvider>;
  const { rerender } = render(view(1));
  const scroller = screen.getByTestId('room-message-scroll');
  expect(scroller.scrollTop).toBe(1200);
  scroller.scrollTop = 200; fireEvent.scroll(scroller);
  const down = screen.getByRole('button', { name: '跳到最新' });
  height = 1600; rerender(view(2)); expect(scroller.scrollTop).toBe(200);
  const scrollTo = vi.spyOn(scroller, 'scrollTo');
  fireEvent.click(down); expect(scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: 'smooth' });
  expect(screen.queryByRole('button', { name: '跳到最新' })).toBeNull();
  height = 1800; rerender(view(3)); expect(scroller.scrollTop).toBe(1800);
});
it('follows delayed layout only while pinned and disconnects the observer', () => {
  let height=900; let resize: (() => void) | undefined;
  const disconnect=vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) {resize=callback;} observe() {} disconnect=disconnect; });
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(()=>height);
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
  const {unmount}=render(<LocaleProvider><RoomMessageList revision={1}>content</RoomMessageList></LocaleProvider>);
  const scroller=screen.getByTestId('room-message-scroll');
  height=1200; resize?.(); expect(scroller.scrollTop).toBe(1200);
  scroller.scrollTop=100; fireEvent.scroll(scroller); height=1500; resize?.(); expect(scroller.scrollTop).toBe(100);
  unmount(); expect(disconnect).toHaveBeenCalled();
});
