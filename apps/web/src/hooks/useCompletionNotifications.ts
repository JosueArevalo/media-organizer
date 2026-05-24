import { useEffect, useRef } from 'react';
import { useCompressionSessionState } from './useCompressionJobState';
import { useExportJobState } from './useExportJobState';
import { useTranslation } from '../i18n';
import { notifyCompletion } from '../services/completion-notification.service';

export const useCompletionNotifications = () => {
  const { t } = useTranslation();
  const compressionSessionState = useCompressionSessionState();
  const exportJobState = useExportJobState();
  const previousCompressionStatusRef = useRef(compressionSessionState.status);
  const previousExportStatusRef = useRef(exportJobState.status);

  useEffect(() => {
    const previousStatus = previousCompressionStatusRef.current;
    previousCompressionStatusRef.current = compressionSessionState.status;

    if (
      previousStatus !== 'completed' &&
      compressionSessionState.status === 'completed' &&
      compressionSessionState.backendSessionId &&
      compressionSessionState.completedAt
    ) {
      void notifyCompletion('compressionCompleted', {
        title: t('notifications.compressionCompleted.title'),
        body: t('notifications.compressionCompleted.body'),
        dedupeKey: `compression:${compressionSessionState.backendSessionId}:${compressionSessionState.completedAt}`
      });
    }
  }, [
    compressionSessionState.backendSessionId,
    compressionSessionState.completedAt,
    compressionSessionState.status,
    t
  ]);

  useEffect(() => {
    const previousStatus = previousExportStatusRef.current;
    previousExportStatusRef.current = exportJobState.status;

    if (
      previousStatus !== 'completed' &&
      exportJobState.status === 'completed' &&
      exportJobState.backendJobId &&
      exportJobState.completedAt
    ) {
      void notifyCompletion('exportCompleted', {
        title: t('notifications.exportCompleted.title'),
        body: t('notifications.exportCompleted.body'),
        dedupeKey: `export:${exportJobState.backendJobId}:${exportJobState.completedAt}`
      });
    }
  }, [
    exportJobState.backendJobId,
    exportJobState.completedAt,
    exportJobState.status,
    t
  ]);
};
