import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { DarkModeProvider } from '@/hooks/useDarkMode';
import { bootstrapAuth } from '@/services/bootstrap';

import './main.css';

const authService = bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <DarkModeProvider>
    <AuthProvider authService={authService}>
      <App />
    </AuthProvider>
  </DarkModeProvider>
);
