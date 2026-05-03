import { createContext, useContext, useState, type ReactNode } from 'react';
import type { MeResponse } from '../api/types';

interface AuthContextValue {
  me: MeResponse;
  accessToken: string;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me] = useState<MeResponse>({
    id: 'local',
    username: 'local@xiaok',
    email: 'local@xiaok',
    email_verified: true,
    work_enabled: true,
  });
  const [accessToken] = useState('local-token');

  // Local mode has no logout
  const logout = () => {
    // No-op in local mode
  };

  return (
    <AuthContext.Provider value={{ me, accessToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}