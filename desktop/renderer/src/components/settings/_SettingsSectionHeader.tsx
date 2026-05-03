type Props = {
  title: string
  description?: string
}

export function SettingsSectionHeader({ title, description }: Props) {
  return (
    <div>
      <h3 className="text-base font-semibold text-[var(--c-text-heading)]">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{description}</p>
      )}
    </div>
  )
}
