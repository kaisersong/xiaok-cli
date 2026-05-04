// Export types
export type AppError = { message: string; traceId?: string; code?: string };
export type AuthApi = unknown;

// Error types
export function formatErrorForDisplay(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

// Error display
export function ErrorCallout({ error }: { error?: unknown }) {
  if (!error) return null;
  const msg = formatErrorForDisplay(error);
  return <div style={{ color: 'red', padding: 8 }}>{msg}</div>;
}

// Form controls
export function AutoResizeTextarea(props: Record<string, unknown>) {
  return <textarea {...props} />;
}

export function FormField(props: Record<string, unknown>) {
  return <div {...props} />;
}

export function Button({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
  return <button {...props}>{children}</button>;
}

// Modal
export function Modal({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
  return <div {...props}>{children}</div>;
}

// Badge
export function Badge({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
  return <span {...props}>{children}</span>;
}

// Toast (stub)
export function useToast() {
  return { show: () => {} };
}

// Debug bus (stub)
export const debugBus = {
  on: () => () => {},
  off: () => {},
  emit: () => {},
};

// ConfirmDialog
export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
}: {
  open?: boolean;
  title?: string;
  message?: string;
  children?: React.ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-xl bg-white p-5 shadow-xl" style={{ minWidth: 320, maxWidth: 420 }}>
        {title && <h3 className="mb-2 text-sm font-semibold text-[var(--c-text-heading)]">{title}</h3>}
        {message && <p className="mb-4 text-sm text-[var(--c-text-secondary)]">{message}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-gray-100"
          >
            {cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600"
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// PillToggle
export function PillToggle({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-full bg-gray-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            opt.value === value
              ? 'bg-[var(--c-accent)] text-white'
              : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// TabBar
export function TabBar({ tabs, activeTab, onTabChange }: Record<string, unknown> & {
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (key: string) => void;
}) {
  return (
    <nav className="flex gap-1 border-b border-[var(--c-border)]">
      {(tabs as Array<{ key: string; label: string }>)?.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => (onTabChange as (key: string) => void)?.(tab.key)}
          className={`px-3 py-2 text-sm ${
            tab.key === activeTab
              ? 'border-b-2 border-[var(--c-accent)] font-medium text-[var(--c-text-heading)]'
              : 'text-[var(--c-text-tertiary)]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// Loading states
export function FullScreenLoading({ label }: { label?: string }) {
  return <div className="flex h-screen items-center justify-center">{label || 'Loading...'}</div>;
}

export function LoadingPage({
  label,
  error,
  onRetry,
  retryLabel,
}: {
  label?: string;
  error?: { title: string; message: string };
  onRetry?: () => void;
  retryLabel?: string;
}) {
  if (error)
    return (
      <div className="p-5">
        {error.title}: {error.message}
        {onRetry && (
          <button onClick={onRetry} className="ml-2 text-[var(--c-accent)]">
            {retryLabel || 'Retry'}
          </button>
        )}
      </div>
    );
  return <div className="flex h-screen items-center justify-center">{label || 'Loading...'}</div>;
}

// Auth page stub
export function AuthPage(props: Record<string, unknown>) {
  return <div {...props} />;
}

// Date/time helpers (stubs)
export function formatDateTime(ts: number): string {
  try { return new Date(ts).toLocaleString() } catch { return ''; }
}
export function formatMonthDay(ts: number): string {
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return ''; }
}
export function getActiveTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC'; }
}
export function isSameCalendarDay(a: number, b: number): boolean {
  try {
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  } catch { return false; }
}

// Tool name helpers (stubs)
export function canonicalToolName(name: string): string { return name; }
export function pickLogicalToolName(): string { return 'default'; }

// Channel envelope helper (stub)
export function normalizeChannelEnvelopeText(text: string): string { return text; }

// Catalog routing stub
export const routeAdvancedJsonFromAvailableCatalog = (c: unknown) => c;
