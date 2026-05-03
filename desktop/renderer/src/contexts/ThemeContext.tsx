import { readThemeFromStorage, writeThemeToStorage } from '../storage'
import {
  ThemeProvider as SharedThemeProvider,
  useTheme,
} from '@arkloop/shared/contexts/theme'
import type { Theme } from '@arkloop/shared/contexts/theme'
import type { ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <SharedThemeProvider
      readTheme={readThemeFromStorage}
      writeTheme={writeThemeToStorage}
    >
      {children}
    </SharedThemeProvider>
  )
}

export { useTheme }
export type { Theme }
