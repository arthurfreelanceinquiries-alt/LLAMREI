import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RemoteAccessGate } from './components/auth/RemoteAccessGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RemoteAccessGate><App /></RemoteAccessGate>
  </StrictMode>,
);
