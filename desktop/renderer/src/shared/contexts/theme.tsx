export type Theme = 'light' | 'dark' | 'system';
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const useTheme = () => ({ theme: 'light' as Theme, setTheme: () => {} });
