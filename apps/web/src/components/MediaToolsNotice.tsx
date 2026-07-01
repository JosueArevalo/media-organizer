import { Link } from 'react-router-dom';
import type { ToolPreflightState } from '../hooks/useToolPreflight';
import { useTranslation } from '../i18n';

type MediaToolsNoticeProps = {
  preflight: ToolPreflightState;
  returnTo: '/dashboard' | '/import' | '/compression';
};

export type MediaToolsNoticeTone = 'loading' | 'warning' | 'error';

export const getMediaToolsNoticeTone = (
  status: ToolPreflightState['status'],
  pythonMissing: boolean
): MediaToolsNoticeTone => {
  if (status === 'loading') return 'loading';
  if (status === 'error' || pythonMissing) return 'error';
  return 'warning';
};

export const MediaToolsNotice = ({ preflight, returnTo }: MediaToolsNoticeProps) => {
  const { t } = useTranslation();
  const missing = preflight.snapshot
    ? Object.values(preflight.snapshot.tools)
      .filter((tool) => tool.key !== 'exiftool' && tool.status !== 'ready')
      .map((tool) => tool.label)
    : [];
  const pythonMissing = preflight.snapshot?.python.status === 'missing';
  const tone = getMediaToolsNoticeTone(preflight.status, pythonMissing);

  if (preflight.status === 'ready' && missing.length === 0 && !pythonMissing) {
    return null;
  }

  return (
    <section className={`page-card tool-preflight-notice tool-preflight-notice-${tone}`} aria-live="polite">
      <div>
        <div className="tool-preflight-title-row">
          <span className="tool-preflight-icon" aria-hidden="true">⚠</span>
          <p className="page-section-title">{t('toolsPreflight.title')}</p>
        </div>
        <p className="page-summary-note">
          {preflight.status === 'loading'
            ? t('toolsPreflight.checking')
            : preflight.status === 'error'
              ? t('toolsPreflight.unknown')
              : pythonMissing
                ? t('toolsPreflight.pythonMissing')
                : t('toolsPreflight.missing', { tools: missing.join(', ') })}
        </p>
        <p className="page-summary-note">{t('toolsPreflight.nonBlocking')}</p>
      </div>
      <Link className="btn btn-primary" to="/settings" state={{ returnTo }}>
        {t('toolsPreflight.configure')}
      </Link>
    </section>
  );
};
