import type { ThemeDefinition, ThemePreset } from './types'

export const BUILTIN_PRESETS: Record<string, ThemeDefinition> = {
  terra: {
    id: 'terra',
    name: 'Terra',
    dark: {
      '--c-bg-base': '#1a1612',
      '--c-bg-deep': '#141210',
      '--c-bg-elevated': '#231f1a',
      '--c-accent': '#c69749',
    },
    light: {
      '--c-bg-base': '#faf6f0',
      '--c-bg-deep': '#f0ebe3',
      '--c-bg-elevated': '#ffffff',
      '--c-accent': '#a67c3d',
    },
  },
  github: {
    id: 'github',
    name: 'GitHub',
    dark: {
      '--c-bg-base': '#0d1117',
      '--c-bg-deep': '#010409',
      '--c-bg-elevated': '#161b22',
      '--c-accent': '#58a6ff',
    },
    light: {
      '--c-bg-base': '#ffffff',
      '--c-bg-deep': '#f6f8fa',
      '--c-bg-elevated': '#ffffff',
      '--c-accent': '#0969da',
    },
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    dark: {
      '--c-bg-base': '#2e3440',
      '--c-bg-deep': '#242933',
      '--c-bg-elevated': '#3b4252',
      '--c-accent': '#88c0d0',
    },
    light: {
      '--c-bg-base': '#eceff4',
      '--c-bg-deep': '#e5e9f0',
      '--c-bg-elevated': '#ffffff',
      '--c-accent': '#5e81ac',
    },
  },
  catppuccin: {
    id: 'catppuccin',
    name: 'Catppuccin',
    dark: {
      '--c-bg-base': '#1e1e2e',
      '--c-bg-deep': '#181825',
      '--c-bg-elevated': '#313244',
      '--c-accent': '#cba6f7',
    },
    light: {
      '--c-bg-base': '#eff1f5',
      '--c-bg-deep': '#e6e9ef',
      '--c-bg-elevated': '#ffffff',
      '--c-accent': '#8839ef',
    },
  },
  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: {
      '--c-bg-base': '#1a1b26',
      '--c-bg-deep': '#16161e',
      '--c-bg-elevated': '#24283b',
      '--c-accent': '#7aa2f7',
    },
    light: {
      '--c-bg-base': '#d5d6db',
      '--c-bg-deep': '#cbccd1',
      '--c-bg-elevated': '#e9e9ec',
      '--c-accent': '#34548a',
    },
  },
}
