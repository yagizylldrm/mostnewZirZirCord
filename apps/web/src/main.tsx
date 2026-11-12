// Must stay the first import: configures zod before any schema is created.
import './lib/zod-csp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { showNotification, startBadgeSync } from './lib/notify';
import './lib/sounds';
import { call, zz } from './lib/zz';

zz.onNotify = showNotification;
zz.start();
startBadgeSync();
// Dev-only handle for debugging and end-to-end tests.
if (import.meta.env.DEV) (window as any).__zz = { zz, call };
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
