import { createRoot } from 'react-dom/client';

import App from '@/App';
import { I18nProvider } from '@/i18n';

import './main.css';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
