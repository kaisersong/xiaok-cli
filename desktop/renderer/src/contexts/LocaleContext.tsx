import { createLocaleContext } from '@arkloop/shared/contexts/locale'
import { locales, type LocaleStrings } from '../locales'
import { readLocaleFromStorage, writeLocaleToStorage } from '../storage'
import type { ReactNode } from 'react'

const { LocaleProvider: SharedLocaleProvider, useLocale } =
  createLocaleContext<LocaleStrings>()

export function LocaleProvider({ children }: { children: ReactNode }) {
  return (
    <SharedLocaleProvider
      locales={locales}
      readLocale={readLocaleFromStorage}
      writeLocale={writeLocaleToStorage}
    >
      {children}
    </SharedLocaleProvider>
  )
}

export { useLocale }
