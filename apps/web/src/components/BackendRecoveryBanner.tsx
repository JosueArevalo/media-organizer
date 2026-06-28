import { useTranslation } from '../i18n';
import type { useDesktopBackendRecovery } from '../hooks/useDesktopBackendRecovery';

type Props = { recovery: ReturnType<typeof useDesktopBackendRecovery> };

export const BackendRecoveryBanner = ({ recovery }: Props) => {
  const { t } = useTranslation();
  if (!recovery.shouldShowRecovery) return null;

  return (
    <section className="backend-recovery-banner" role="alert">
      <div>
        <strong>{t('backendRecovery.title')}</strong>
        <p>{t('backendRecovery.body')}</p>
        {recovery.state?.incident?.message ? <code>{recovery.state.incident.message}</code> : null}
        {recovery.actionMessage === 'copied' ? <p>{t('backendRecovery.copied')}</p> : recovery.actionMessage ? <p>{recovery.actionMessage}</p> : null}
      </div>
      <div className="backend-recovery-actions">
        <button className="btn btn-primary" type="button" disabled={recovery.isRestarting} onClick={() => void recovery.restart()}>
          {recovery.isRestarting ? t('backendRecovery.restarting') : t('backendRecovery.restart')}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => void recovery.openLogs()}>{t('backendRecovery.openLogs')}</button>
        <button className="btn btn-secondary" type="button" onClick={() => void recovery.copyDiagnostics()}>{t('backendRecovery.copy')}</button>
      </div>
    </section>
  );
};
