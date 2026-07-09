import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/main.css';
import './styles/app.css';
import './styles/components.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { setupCustomAlert } from '@/utils/alert';

applyStoredTheme();
setupCustomAlert();

function clearDesktopWebCache() {
  const isDesktopShell = Boolean((window as any).__TAURI__);
  if (!isDesktopShell) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(() => {});
  }

  if ('caches' in window) {
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .catch(() => {});
  }
}

clearDesktopWebCache();

requestAnimationFrame(() => {
  document.documentElement.classList.remove('no-transition');
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
