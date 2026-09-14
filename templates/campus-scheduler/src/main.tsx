import { createRoot } from 'react-dom/client';

import App from '@/App';
import { I18nProvider } from '@/i18n';
// Imported for its side effect, and imported HERE so it happens before the first render: the
// module puts data-theme on <html> as it loads, which is what stops a dark-mode visitor seeing a
// white flash. Nothing below reads its exports.
import '@/theme';

import './main.css';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
