/** Boolean control for skills; the shared choice-pill API is a different control. */
export function BooleanSwitch({ checked, disabled, ariaLabel, onChange }: {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={['relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40', checked ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border-subtle)]'].join(' ')}>
      <span className={['inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
    </button>
  );
}
