import type { LabelHTMLAttributes, ReactNode } from 'react'
import { settingsLabelCls } from './_settingsClasses'

type Props = {
  size?: 'sm' | 'md'
  children: ReactNode
} & Omit<LabelHTMLAttributes<HTMLLabelElement>, 'children'>

export function SettingsLabel({ size = 'sm', className, children, ...rest }: Props) {
  return (
    <label
      className={`${settingsLabelCls(size)}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </label>
  )
}
