import type { Locale } from '../i18n';

export const LanguageFlag = ({ locale }: { locale: Locale }) => locale === 'es' ? (
  <svg className="language-flag" viewBox="0 0 24 16" aria-hidden="true">
    <rect width="24" height="16" rx="1" fill="#AA151B" />
    <rect y="4" width="24" height="8" fill="#F1BF00" />
  </svg>
) : (
  <svg className="language-flag" viewBox="0 0 24 16" aria-hidden="true">
    <rect width="24" height="16" rx="1" fill="#012169" />
    <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.4" />
    <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.4" />
    <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5" />
    <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="2.6" />
  </svg>
);
