import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Info, X } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { useLocale } from '../../contexts/LocaleContext'

/** Shared help presentation: existing Modal owns Escape and outside click. */
export function ModelInfoDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLocale()
  const id = useId()
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => { if (previous?.isConnected && !previous.closest('[hidden]')) previous.focus() }
  }, [open])
  return <Modal open={open} onClose={onClose} width="540px">
    <div role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={event => {
      if (event.key === 'Tab') {
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,a[href]'))
        const current = nodes.indexOf(document.activeElement as HTMLElement)
        if (nodes.length) { event.preventDefault(); nodes[(current + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus() }
      }
    }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 id={id} className="text-sm font-semibold text-[var(--c-text-heading)]">{title}</h4>
        <button ref={close} type="button" aria-label={t.desktopSettings.modelInfoClose} onClick={onClose} className="flex size-7 items-center justify-center rounded-lg text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"><X size={16}/></button>
      </div>
      <div className="flex flex-col gap-3 break-words text-xs leading-relaxed text-[var(--c-text-secondary)]">{children}</div>
    </div>
  </Modal>
}
export function ModelInfoButton({ title, active = true, children }: { title: string; active?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (!active) setOpen(false) }, [active])
  return <>
    <button type="button" aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open && active} onClick={event => { event.currentTarget.focus(); setOpen(true) }} className="flex size-6 items-center justify-center rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"><Info size={15}/></button>
    <ModelInfoDialog open={open && active} title={title} onClose={() => setOpen(false)}>{children}</ModelInfoDialog>
  </>
}
