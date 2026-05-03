export function createLocaleContext(strings: Record<string, unknown>) {
  return { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useLocale: () => ({ t: strings }) };
}
