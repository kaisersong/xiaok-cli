export type FontFamily =
  | 'default'
  | 'inter'
  | 'system'
  | 'serif'
  | 'noto-sans'
  | 'source-sans'
  | 'custom'

export type CodeFontFamily =
  | 'jetbrains-mono'
  | 'fira-code'
  | 'cascadia-code'
  | 'source-code-pro'

export type FontSize = 'compact' | 'normal' | 'relaxed'

export type ThemePreset =
  | 'default'
  | 'terra'
  | 'github'
  | 'nord'
  | 'catppuccin'
  | 'tokyo-night'
  | 'custom'

export type ThemeColorVars = Record<string, string>

export interface ThemeDefinition {
  id: string
  name: string
  dark: Partial<ThemeColorVars>
  light: Partial<ThemeColorVars>
}

export interface ColorGroup {
  key: string
  label: string
  vars: string[]
}

export const COLOR_GROUPS: ColorGroup[] = [
  {
    key: 'background',
    label: 'Background',
    vars: [
      '--c-bg-base',
      '--c-bg-deep',
      '--c-bg-elevated',
      '--c-bg-hover',
      '--c-bg-active',
    ],
  },
  {
    key: 'text',
    label: 'Text',
    vars: [
      '--c-text-primary',
      '--c-text-secondary',
      '--c-text-tertiary',
      '--c-text-inverse',
    ],
  },
  {
    key: 'border',
    label: 'Border',
    vars: [
      '--c-border-default',
      '--c-border-strong',
    ],
  },
  {
    key: 'accent',
    label: 'Accent',
    vars: [
      '--c-accent',
      '--c-accent-hover',
      '--c-accent-text',
    ],
  },
]
