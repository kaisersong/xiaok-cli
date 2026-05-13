import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type Locale = 'zh' | 'en';

interface LocaleContextValue<T> {
  t: T;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

interface LocaleProviderProps<T> {
  locales: Record<Locale, T>;
  readLocale: () => Locale;
  writeLocale: (locale: Locale) => void;
  children: ReactNode;
}

export function createLocaleContext<T>() {
  const Ctx = createContext<LocaleContextValue<T> | null>(null);

  function LocaleProvider({ locales, readLocale, writeLocale, children }: LocaleProviderProps<T>) {
    const [locale, setLocaleState] = useState<Locale>(readLocale);

    const setLocale = useCallback((next: Locale) => {
      setLocaleState(next);
      writeLocale(next);
    }, [writeLocale]);

    const t = locales[locale];

    return (
      <Ctx.Provider value={{ t, locale, setLocale }}>
        {children}
      </Ctx.Provider>
    );
  }

  function useLocale(): LocaleContextValue<T> {
    const ctx = useContext(Ctx);
    if (!ctx) {
      throw new Error('useLocale must be used within a LocaleProvider');
    }
    return ctx;
  }

  return { LocaleProvider, useLocale };
}
