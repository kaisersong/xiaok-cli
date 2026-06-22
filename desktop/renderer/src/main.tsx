import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter as Router } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './contexts/auth';
import { LocaleProvider } from './contexts/LocaleContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppearanceProvider } from './contexts/AppearanceContext';
import { KSwarmProvider } from './contexts/KSwarmContext';
import { ThreadListProvider } from './contexts/thread-list';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LocaleProvider>
            <ThemeProvider>
              <AppearanceProvider>
                <ThreadListProvider>
                  <KSwarmProvider>
                    <App />
                  </KSwarmProvider>
                </ThreadListProvider>
              </AppearanceProvider>
            </ThemeProvider>
          </LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </Router>
  </React.StrictMode>
);
