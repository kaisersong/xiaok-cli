// Shim for @arkloop/shared — local mode stubs
export type AppError = { message: string; traceId?: string; code?: string };
export function formatErrorForDisplay(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
export function ErrorCallout({ error }: { error?: unknown }) {
  if (!error) return null;
  const msg = formatErrorForDisplay(error);
  return <div style={{ color: 'red', padding: 8 }}>{msg}</div>;
}
export function AutoResizeTextarea(props: Record<string, unknown>) {
  return <textarea {...props} />;
}
export function Modal(props: Record<string, unknown>) {
  return <div {...props} />;
}
export function Badge(props: Record<string, unknown>) {
  return <span {...props} />;
}
export function PillToggle(props: Record<string, unknown>) {
  return <div {...props} />;
}
export function TabBar(props: Record<string, unknown>) {
  return <nav {...props} />;
}
export function FullScreenLoading({ label }: { label?: string }) {
  return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>{label || 'Loading...'}</div>;
}
export function LoadingPage({ label, error, onRetry, retryLabel }: { label?: string; error?: { title: string; message: string }; onRetry?: () => void; retryLabel?: string }) {
  if (error) return <div style={{ padding: 20 }}>{error.title}: {error.message}{onRetry && <button onClick={onRetry}>{retryLabel || 'Retry'}</button>}</div>;
  return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>{label || 'Loading...'}</div>;
}
export function createLocaleContext(strings: Record<string, unknown>) {
  return { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useLocale: () => ({ t: strings }) };
}
export function AuthPage(props: Record<string, unknown>) {
  return <div {...props} />;
}
export const routeAdvancedJsonFromAvailableCatalog = (c: unknown) => c;
