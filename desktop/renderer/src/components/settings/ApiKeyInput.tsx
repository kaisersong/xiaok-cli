import { SecretInput } from '../security/SecretInput';
import { useState } from 'react';
import type { LocaleStrings } from '../../locales/index';
import { inputCls } from './settings-ui';

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 12)) + key.slice(-4);
}

interface ApiKeyInputProps {
  ariaLabel: string;
  placeholder: string;
  storedValue: string; // the actual key from draft (may be empty)
  onChange: (newValue: string) => void;
}

export function ApiKeyInput({ ariaLabel, placeholder, storedValue, onChange, ds }: ApiKeyInputProps & { ds: LocaleStrings['desktopSettings'] }) {
  const [editing, setEditing] = useState(!storedValue);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    setEditValue('');
    setEditing(true);
  };

  const commitEdit = () => {
    // If user typed nothing new, keep storedValue; otherwise onChange was already called
    setEditing(false);
    if (!editValue.trim() && storedValue) {
      // no-op: keep existing stored value
    }
  };

  const cancelEdit = () => {
    setEditValue('');
    setEditing(false);
  };

  const handleChange = (v: string) => {
    setEditValue(v);
    if (v.trim()) onChange(v.trim());
  };

  if (!editing && storedValue) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span
          className="flex-1 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-deep)] px-3 py-2 text-sm font-mono text-[var(--c-text-secondary)] select-none"
          aria-label={ariaLabel}
        >
          {maskApiKey(storedValue)}
        </span>
        <button
          type="button"
          onClick={startEdit}
          className="shrink-0 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
          aria-label={`edit-${ariaLabel}`}
        >
          {ds.connectorChangeKey}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <SecretInput
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={`flex-1 ${inputCls}`}
        value={editValue}
        autoFocus
        onChange={e => handleChange(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') cancelEdit();
        }}
      />
      {storedValue && (
        <button
          type="button"
          onClick={cancelEdit}
          className="shrink-0 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
          aria-label={`cancel-edit-${ariaLabel}`}
        >
          {ds.connectorCancelEdit}
        </button>
      )}
    </div>
  );
}
