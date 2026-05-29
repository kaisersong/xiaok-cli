const inputBase =
  'w-full border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 text-sm ' +
  'text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] ' +
  'transition-colors duration-150 focus:border-[var(--c-border)]'

const inputSizes = {
  sm: 'rounded-lg py-1.5',
  md: 'rounded-lg py-2',
} as const

const labelSizes = {
  sm: 'mb-1 block text-xs font-medium text-[var(--c-text-secondary)]',
  md: 'mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]',
} as const

export function settingsInputCls(variant: 'sm' | 'md' = 'sm') {
  return `${inputBase} ${inputSizes[variant]}`
}

export function settingsLabelCls(size: 'sm' | 'md' = 'sm') {
  return labelSizes[size]
}
