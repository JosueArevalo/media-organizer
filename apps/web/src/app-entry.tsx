import App from './App';
import { I18nProvider } from './i18n';

const AppEntry = () => (
  <I18nProvider>
    <App />
  </I18nProvider>
);

export default AppEntry;
