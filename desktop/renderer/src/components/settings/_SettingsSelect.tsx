import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type SettingsSelectOption = { value: string; label: string }

type Props = {
  value: string
  options: SettingsSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

export function SettingsSelect({ value, options, onChange, disabled, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (disabled) return
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0
      const scrollX = window.scrollX || document.documentElement.scrollLeft || 0
      setMenuStyle({
        position: 'absolute',
        top: rect.bottom + scrollY + 4,
        left: rect.left + scrollX,
        width: rect.width,
        zIndex: 9999,
      })
    }
    setOpen((v) => !v)
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? value

  const menu = open ? (
    <div
      ref={menuRef}
      className="dropdown-menu"
      style={{
        ...menuStyle,
        border: '0.5px solid var(--c-border-subtle)',
        borderRadius: '10px',
        padding: '4px',
        background: 'var(--c-bg-menu)',
        boxShadow: 'var(--c-dropdown-shadow)',
        maxHeight: '220px',
        overflowY: 'auto',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => { onChange(opt.value); setOpen(false) }}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors bg-[var(--c-bg-menu)] hover:bg-[var(--c-bg-deep)]"
          style={{
            color: value === opt.value ? 'var(--c-text-heading)' : 'var(--c-text-secondary)',
            fontWeight: value === opt.value ? 500 : 400,
          }}
        >
          <span>{opt.label}</span>
          {value === opt.value && <Check size={13} className="shrink-0" />}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className="flex w-full items-center justify-between rounded-lg bg-[var(--c-bg-input)] px-3 py-1.5 text-sm text-[var(--c-text-primary)] transition-colors hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ border: '1px solid var(--c-border-subtle)' }}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown size={13} className="ml-2 shrink-0 text-[var(--c-text-muted)]" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
