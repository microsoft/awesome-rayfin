import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { bootstrapAuth } from '@/services/bootstrap';

import './main.css';

const authService = bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <AuthProvider authService={authService}>
      <App />
    </AuthProvider>
  </I18nProvider>
);
