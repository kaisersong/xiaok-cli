import type { ReactNode } from 'react'

interface ProviderSelectCardProps {
  title: string
  description: string
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  icon?: ReactNode
  badge?: ReactNode
  status?: ReactNode
  children?: ReactNode
}

export function ProviderSelectCard({
  title,
  description,
  selected,
  onSelect,
  disabled,
  icon,
  badge,
  status,
  children,
}: ProviderSelectCardProps) {
  const hasExtra = !!(badge || status || children)
  return (
    <div
      className="rounded-xl transition-[border-color] duration-150"
      style={{
        minWidth: 223,
        border: selected
          ? '1.5px solid var(--c-accent-send)'
          : '0.5px solid var(--c-input-border-color)',
        background: 'var(--c-bg-input)',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className="flex w-full items-center gap-3 rounded-xl px-4 text-left transition-all duration-150"
        style={{ minHeight: hasExtra ? undefined : 60, paddingTop: hasExtra ? 12 : undefined, paddingBottom: hasExtra ? 12 : undefined }}
        onMouseEnter={(e) => {
          if (!selected && !disabled) {
            const wrapper = e.currentTarget.parentElement
            if (wrapper) {
              wrapper.style.borderColor = 'var(--c-input-border-color-hover)'
              wrapper.style.background = 'var(--c-bg-card-hover)'
            }
          }
        }}
        onMouseLeave={(e) => {
          if (!selected) {
            const wrapper = e.currentTarget.parentElement
            if (wrapper) {
              wrapper.style.borderColor = 'var(--c-input-border-color)'
              wrapper.style.background = 'var(--c-bg-input)'
            }
          }
        }}
      >
        <div
          className="shrink-0 self-center rounded-full transition-[border-width,border-color] duration-150"
          style={{
            width: 14,
            height: 14,
            border: selected
              ? '4px solid var(--c-accent-send)'
              : '1.5px solid var(--c-border-mid)',
          }}
        />
        {icon && (
          <div
            className="flex shrink-0 items-center justify-center transition-colors duration-150"
            style={{ color: selected ? 'var(--c-accent-send)' : 'var(--c-text-muted)', width: 16, height: 16 }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium leading-tight text-[var(--c-text-primary)]">
              {title}
            </span>
            {badge}
          </div>
          <div className="mt-0.5 truncate text-[11px] leading-tight text-[var(--c-text-muted)]">
            {description}
          </div>
          {status && <div className="mt-1">{status}</div>}
        </div>
      </button>

      {selected && children && (
        <div
          className="overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ display: 'grid', gridTemplateRows: '1fr' }}
        >
          <div className="overflow-hidden">
            <div
              className="rounded-b-xl border-t px-4 pb-4 pt-3"
              style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg-page)' }}
            >
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
