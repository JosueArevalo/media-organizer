import { useEffect, useRef } from 'react';
import { useCompressionSessionState } from './useCompressionJobState';
import { useExportJobState } from './useExportJobState';
import { useTranslation } from '../i18n';
import { notifyCompletion } from '../services/completion-notification.service';

export const useCompletionNotifications = () => {
  const { t } = useTranslation();
  const compressionSessionState = useCompressionSessionState();
  const networkExportJobState = useExportJobState('network-folder');
  const googlePhotosExportJobState = useExportJobState('google-photos');
  const previousCompressionStatusRef = useRef(compressionSessionState.status);
  const previousExportStatusRef = useRef({
    'network-folder': networkExportJobState.status,
    'google-photos': googlePhotosExportJobState.status
  });

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
    for (const exportJobState of [networkExportJobState, googlePhotosExportJobState]) {
      if (!exportJobState.targetType) continue;

      const previousStatus = previousExportStatusRef.current[exportJobState.targetType];
      previousExportStatusRef.current[exportJobState.targetType] = exportJobState.status;

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
    }
  }, [
    googlePhotosExportJobState,
    networkExportJobState,
    t
  ]);
};
