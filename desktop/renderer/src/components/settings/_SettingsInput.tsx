import type { InputHTMLAttributes } from 'react'
import { settingsInputCls } from './_settingsClasses'

type Props = {
  variant?: 'sm' | 'md'
} & InputHTMLAttributes<HTMLInputElement>

export function SettingsInput({ variant = 'sm', className, ...rest }: Props) {
  return (
    <input
      className={`${settingsInputCls(variant)}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}
