import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter as Router } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './contexts/auth';
import { LanguageProvider } from './contexts/LanguageContext';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
