type ExternalAnchorEvent = {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault(): void;
};
/** Requests the existing Main window-open policy; does not acknowledge OS completion. */
export function openExternal(rawUrl: string): void {
  if (typeof rawUrl !== 'string') return;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
export function handleExternalAnchorClick(event: ExternalAnchorEvent, url: string): void {
  if (event.defaultPrevented || event.button !== undefined && event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openExternal(url);
}
