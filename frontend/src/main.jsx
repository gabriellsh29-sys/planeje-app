import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

if (import.meta.env.VITE_SUPABASE_URL) {
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = import.meta.env.VITE_SUPABASE_URL;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
