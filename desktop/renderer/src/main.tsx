import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter as Router } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './contexts/auth';
import { LocaleProvider } from './contexts/LocaleContext';
import { KSwarmProvider } from './contexts/KSwarmContext';
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
            <KSwarmProvider>
              <App />
            </KSwarmProvider>
          </LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </Router>
  </React.StrictMode>
);
